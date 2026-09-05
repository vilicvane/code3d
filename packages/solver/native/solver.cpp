// SPDX-License-Identifier: LGPL-2.1-or-later
#include <algorithm>
#include <cmath>
#include <map>
#include <string>
#include <vector>
#include <emscripten/bind.h>

#include "CREATE.h"
#include "AbsConstraint.h"
#include "Constraint.h"
#include "ExternalSystem.h"
#include "Joint.h"
#include "MarkerFrame.h"
#include "Part.h"
#include "PartFrame.h"
#include "PosICNewtonRaphson.h"
#include "SingularMatrixError.h"
#include "SparseMatrix.h"
#include "System.h"
#include "SystemSolver.h"

using namespace MbD;
using emscripten::val;

namespace {

// Ondsel's Part::asFixed() fixes coordinates to zero. Our input contract fixes
// a body at its supplied pose, including translated and rotated references.
class FixedCoordinate final : public AbsConstraint {
public:
    explicit FixedCoordinate(size_t axis) : AbsConstraint(axis) {}
    void calcPostDynCorrectorIteration() override {
        AbsConstraint::calcPostDynCorrectorIteration();
        aG -= aConstant;
    }
    std::string constraintSpec() override { return "FixedCoordinate" + std::to_string(axis); }
};

// Ondsel's hard equations remain in the Lagrange multiplier system. Preferences
// contribute only to its objective; no penalty weight can relax a hard equation.
class AssemblySolver final : public PosICNewtonRaphson {
public:
    std::vector<std::shared_ptr<Constraint>> preferences;

    void run() override {
        // Each restart must remove at least one redundant equation. This bounds
        // Ondsel's otherwise unbounded retry loop on degenerate input.
        size_t previousCount = SIZE_MAX;
        while (true) {
            try {
                preRun();
                initializeLocally();
                initializeGlobally();
                iterate();
                postRun();
                return;
            } catch (const SingularMatrixError& error) {
                const auto count = system->allConstraints()->size();
                if (count >= previousCount || error.getRedundantEqnNos()->empty()) throw;
                previousCount = count;
                system->partsJointsMotionsDo([&](std::shared_ptr<Item> item) {
                    item->removeRedundantConstraints(error.getRedundantEqnNos());
                    item->setqsu(qsuOld);
                });
            }
        }
    }

    void initializeGlobally() override {
        PosICNewtonRaphson::initializeGlobally();
        // A small pose regularizer selects a stable solution if the relational
        // preferences still leave freedoms. Coordinates are normalized by core.
        std::fill(qsuWeights->begin(), qsuWeights->end(), 1e-10);
        for (auto& constraint : preferences) {
            constraint->iG = 0;
            constraint->useEquationNumbers();
        }
        gradient = std::make_shared<SparseMatrix<double>>(1, nqsu);
    }

    void handleSingularMatrix() override {
        // Ondsel's full-pivot pre-scaling throws on an entirely zero row before
        // it can report its equation number (e.g. a point related to itself).
        // Report those rows through the same bounded redundancy mechanism.
        std::vector<size_t> zeroRows;
        for (size_t row = nqsu; row < n; ++row) {
            if (pypx->at(row)->maxMagnitude() == 0) zeroRows.push_back(row);
        }
        if (!zeroRows.empty()) {
            throw SingularMatrixError("Zero constraint Jacobian rows",
                std::make_shared<FullColumn<size_t>>(zeroRows.begin(), zeroRows.end()));
        }
        PosICNewtonRaphson::handleSingularMatrix();
    }

    void fillY() override {
        PosICNewtonRaphson::fillY();
        for (auto& constraint : preferences) {
            constraint->postPosICIteration();
            gradient->zeroSelf();
            constraint->fillPosKineJacob(gradient);
            for (const auto& [i, derivative] : *gradient->at(0)) {
                y->atiminusNumber(i, constraint->aG * derivative);
            }
        }
    }

    void fillPyPx() override {
        PosICNewtonRaphson::fillPyPx();
        // Gauss-Newton curvature keeps the objective's coordinate block positive
        // definite (negative here by Ondsel's sign convention).
        for (auto& constraint : preferences) {
            gradient->zeroSelf();
            constraint->fillPosKineJacob(gradient);
            for (const auto& [i, di] : *gradient->at(0)) {
                for (const auto& [j, dj] : *gradient->at(0)) {
                    pypx->atijminusNumber(i, j, di * dj);
                }
            }
        }
    }

private:
    SpMatDsptr gradient;
};

FColDsptr column(const val& array) {
    return std::make_shared<FullColumn<double>>(std::initializer_list<double>{
        array[0].as<double>(), array[1].as<double>(), array[2].as<double>()});
}

FMatDsptr matrix(const val& q) {
    const auto x = q[0].as<double>(), y = q[1].as<double>();
    const auto z = q[2].as<double>(), w = q[3].as<double>();
    return std::make_shared<FullMatrix<double>>(std::initializer_list<std::initializer_list<double>>{
        {1 - 2*(y*y + z*z), 2*(x*y - z*w), 2*(x*z + y*w)},
        {2*(x*y + z*w), 1 - 2*(x*x + z*z), 2*(y*z - x*w)},
        {2*(x*z - y*w), 2*(y*z + x*w), 1 - 2*(x*x + y*y)}});
}

EndFrmsptr marker(const val& input, const std::vector<std::shared_ptr<Part>>& parts) {
    auto frame = CREATE<MarkerFrame>::With("anchor");
    frame->setrpmp(column(input["position"]));
    frame->setaApm(matrix(input["quaternion"]));
    parts.at(input["body"].as<size_t>())->partFrame->addMarkerFrame(frame);
    return frame->endFrames->at(0);
}

std::shared_ptr<Constraint> equation(const val& input, EndFrmsptr i, EndFrmsptr j) {
    auto kind = input["kind"].as<std::string>();
    auto axisI = input["axisI"].as<size_t>();
    std::shared_ptr<Constraint> result;
    if (kind == "point") {
        result = CREATE<AtPointConstraintIqcJqc>::With(i, j, axisI);
    } else if (kind == "distance") {
        result = CREATE<TranslationConstraintIqcJqc>::With(i, j, axisI);
    } else {
        result = CREATE<DirectionCosineConstraintIqcJqc>::With(i, j, axisI, input["axisJ"].as<size_t>());
    }
    result->setConstant(input["value"].as<double>());
    return result;
}

val solve(const val& problem) {
    auto output = val::object();
    auto poses = val::array();
    auto residuals = val::array();
    output.set("poses", poses);
    output.set("residuals", residuals);
    output.set("message", "");

    auto system = CREATE<System>::With();
    std::vector<std::shared_ptr<Part>> parts;
    std::vector<std::shared_ptr<Joint>> hardOwners;
    std::vector<std::shared_ptr<Joint>> preferenceOwners;
    std::vector<std::pair<std::string, std::shared_ptr<Constraint>>> originals;
    auto solver = CREATE<AssemblySolver>::With();
    solver->setSystem(system->systemSolver.get());
    try {
        const auto bodies = problem["bodies"];
        for (size_t index = 0; index < bodies["length"].as<size_t>(); ++index) {
            auto input = bodies[index];
            auto part = CREATE<Part>::With(std::to_string(index));
            part->m = 1;
            part->aJ = std::make_shared<DiagonalMatrix<double>>(std::initializer_list<double>{1, 1, 1});
            part->setqX(column(input["position"]));
            part->setaAap(matrix(input["quaternion"]));
            part->setqXdot(std::make_shared<FullColumn<double>>(3));
            part->setomeOpO(std::make_shared<FullColumn<double>>(3));
            system->addPart(part);
            if (input["fixed"].as<bool>()) {
                for (size_t axis = 0; axis < 7; ++axis) {
                    auto fixed = CREATE<FixedCoordinate>::With(axis);
                    fixed->owner = part->partFrame.get();
                    fixed->setConstant(axis < 3 ? part->getqX()->at(axis) : part->getqE()->at(axis - 3));
                    part->partFrame->aGabs->push_back(fixed);
                }
            }
            parts.push_back(part);
        }
        const auto relations = problem["relations"];
        for (size_t index = 0; index < relations["length"].as<size_t>(); ++index) {
            auto input = relations[index];
            auto id = input["id"].as<std::string>();
            auto i = marker(input["i"], parts), j = marker(input["j"], parts);
            auto hard = CREATE<Joint>::With(id);
            hard->connectsItoJ(i, j);
            hard->owner = system.get();
            hardOwners.push_back(hard);
            auto soft = CREATE<Joint>::With(id);
            soft->connectsItoJ(i, j);
            soft->owner = system.get();
            preferenceOwners.push_back(soft);
            auto equations = input["equations"];
            for (size_t k = 0; k < equations["length"].as<size_t>(); ++k) {
                auto constraint = equation(equations[k], i, j);
                hard->addConstraint(constraint);
                originals.emplace_back(id, constraint);
            }
            auto preferences = input["preferences"];
            for (size_t k = 0; k < preferences["length"].as<size_t>(); ++k) {
                auto constraint = equation(preferences[k], i, j);
                soft->addConstraint(constraint);
            }
        }
        do {
            system->hasChanged = false;
            system->initializeLocally();
            for (auto& owner : hardOwners) owner->initializeLocally();
            for (auto& owner : preferenceOwners) owner->initializeLocally();
            system->initializeGlobally();
            for (auto& owner : hardOwners) owner->initializeGlobally();
            for (auto& owner : preferenceOwners) owner->initializeGlobally();
        } while (system->hasChanged);
        system->partsJointsMotionsDo([](std::shared_ptr<Item> item) { item->postInput(); });
        const auto bodyEquations = system->allConstraints();
        for (auto& owner : hardOwners) { owner->postInput(); owner->prePosIC(); }
        for (auto& owner : preferenceOwners) { owner->postInput(); owner->prePosIC(); }
        system->systemSolver->iterMaxPosKine = 100;
        system->systemSolver->errorTolPosKine = 1e-10;
        // Assemble from all original geometry first. A Jacobian dependency far
        // from the solution is not evidence that a nonlinear equation is
        // redundant. Least squares feasibility avoids dropping those equations
        // before the parts reach an assembled pose.
        for (auto& [id, constraint] : originals) solver->preferences.push_back(constraint);
        solver->run();
        bool feasible = true;
        for (auto& [id, constraint] : originals) {
            constraint->postPosICIteration();
            feasible &= std::isfinite(constraint->aG) && std::abs(constraint->aG) <= 1e-7;
        }
        if (feasible) {
            for (auto& owner : hardOwners) system->addJoint(owner);
            solver = CREATE<AssemblySolver>::With();
            solver->setSystem(system->systemSolver.get());
            for (auto& owner : preferenceOwners) {
                for (auto& constraint : *owner->constraints) solver->preferences.push_back(constraint);
            }
            solver->run();
        }

        std::map<std::string, double> errors;
        for (auto& [id, constraint] : originals) {
            // Removed constraints must refresh their expressions, not just their
            // cached derivatives, before checking the original authored system.
            constraint->postPosICIteration();
            const auto error = std::abs(constraint->aG);
            errors[id] = std::isfinite(error) ? std::max(errors[id], error) : INFINITY;
        }
        bool satisfied = true;
        for (auto& [id, error] : errors) {
            auto residual = val::object();
            residual.set("id", id);
            residual.set("error", error);
            residuals.call<void>("push", residual);
            satisfied &= error <= 1e-7;
        }
        for (auto& constraint : *bodyEquations) {
            constraint->postPosICIteration();
            if (!std::isfinite(constraint->aG) || std::abs(constraint->aG) > 1e-7) {
                throw std::runtime_error("The solver did not preserve a fixed pose or unit quaternion.");
            }
        }
        for (auto& part : parts) {
            auto pose = val::object();
            auto position = val::array(), quaternion = val::array();
            for (size_t k = 0; k < 3; ++k) position.set(k, part->getqX()->at(k));
            for (size_t k = 0; k < 4; ++k) quaternion.set(k, part->getqE()->at(k));
            pose.set("position", position);
            pose.set("quaternion", quaternion);
            poses.call<void>("push", pose);
        }
        output.set("status", satisfied ? "solved" : "unsatisfied");
    } catch (const std::exception& error) {
        output.set("status", "failed");
        output.set("message", std::string(error.what()));
    }
    return output;
}
}

EMSCRIPTEN_BINDINGS(code3d_solver) {
    emscripten::function("solve", &solve);
}

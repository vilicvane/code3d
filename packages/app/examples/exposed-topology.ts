import {box, cylinder, group} from '@code3d/core';

const plate = box(32, 4, 24).paint('#8ed5d1');

// Models become topology references; selected surfaces keep their identity.
const base = group([plate]).expose({
  body: plate,
  mountingFace: plate.surface(1),
});

// Select these bindings to inspect the returned geometry in the viewport.
export const boundary = base.mountingFace.edges();
export const corners = boundary[0].vertices();
export const mountingCenter = base.mountingFace.center;

// Named anchors on an exposed model remain in the containing assembly's frame.
const post = cylinder(3, 12).relate(self => self.bottom.on(base.body.top));
const assembly = group([base, post]).expose({plate: base.body, post});

// Chained references constrain the entire assembly.
const floor = box(50, 2, 40).paint('#777e89');
const placed = assembly.relate(self => self.plate.bottom.on(floor.top));

export default group([floor, placed]);

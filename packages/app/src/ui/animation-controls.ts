import {Pause, Play, RotateCcw} from 'lucide';
import {reaction, type IReactionDisposer} from 'mobx';
import type {ModelAnimation} from '../model/animation';
import {createIcon} from './icons';

type AnimationControlsOptions = Readonly<{
  visible(): boolean;
  canPlay(): boolean;
  canReset(): boolean;
}>;

/** Playback controls retain their interaction targets across model frames. */
export class AnimationControls {
  private readonly root = document.createElement('div');
  private readonly events = new AbortController();
  private readonly stop: IReactionDisposer[];

  constructor(
    container: HTMLElement,
    private readonly animation: ModelAnimation,
    options: AnimationControlsOptions,
  ) {
    this.root.className = 'viewport-animation';
    this.root.id = 'viewport-animation';
    this.root.setAttribute('role', 'group');
    this.root.setAttribute('aria-label', 'Animation playback');

    const play = document.createElement('button');
    play.id = 'animation-play';
    play.type = 'button';
    const reset = document.createElement('button');
    reset.id = 'animation-reset';
    reset.type = 'button';
    reset.setAttribute('aria-label', 'Reset animation');
    reset.title = 'Reset to 0 seconds';
    reset.append(createIcon(RotateCcw));
    const time = document.createElement('output');
    time.id = 'animation-time';
    time.setAttribute('aria-label', 'Time offset');
    this.root.append(play, reset, time);
    container.append(this.root);

    const {signal} = this.events;
    play.addEventListener(
      'click',
      () => {
        if (animation.playing) animation.pause();
        else animation.play();
      },
      {signal},
    );
    reset.addEventListener('click', () => animation.reset(), {signal});
    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.hidden) animation.pause();
      },
      {signal},
    );

    this.stop = [
      reaction(
        () => animation.playing,
        playing => {
          play.replaceChildren(createIcon(playing ? Pause : Play));
          const label = playing ? 'Pause animation' : 'Play animation';
          play.setAttribute('aria-label', label);
          play.title = label;
          play.setAttribute('aria-pressed', String(playing));
        },
        {fireImmediately: true},
      ),
      reaction(
        options.visible,
        visible => {
          this.root.hidden = !visible;
        },
        {fireImmediately: true},
      ),
      reaction(
        () => !animation.playing && (animation.pending || !options.canPlay()),
        disabled => {
          play.disabled = disabled;
        },
        {fireImmediately: true},
      ),
      reaction(
        () => !animation.pending && !options.canReset(),
        disabled => {
          reset.disabled = disabled;
        },
        {fireImmediately: true},
      ),
      reaction(
        () => `${animation.time.toFixed(2)} s`,
        value => {
          time.textContent = value;
        },
        {fireImmediately: true},
      ),
    ];
  }

  dispose(): void {
    this.stop.forEach(stop => stop());
    this.events.abort();
    this.animation.stop();
    this.root.remove();
  }
}

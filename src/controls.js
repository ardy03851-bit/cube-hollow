// ---------------------------------------------------------------------------
// Controls — keyboard (WASD/arrows + mouse) and touch (joystick + buttons),
// tuned for iPad.
// ---------------------------------------------------------------------------
export class Input {
  constructor() {
    this.keys = {};
    this.joyX = 0; this.joyY = 0;
    this.joyActive = false;
    this.placePressed = false;
    this.removePressed = false;
    this.cyclePressed = false;

    addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      if (e.code === 'Space') { this.placePressed = true; e.preventDefault(); }
      if (e.code === 'KeyX' || e.code === 'Backspace') this.removePressed = true;
      if (e.code === 'Tab') { this.cyclePressed = true; e.preventDefault(); }
    });
    addEventListener('keyup', (e) => { this.keys[e.code] = false; });

    this._setupTouch();
  }

  get up() { return this.keys['KeyW'] || this.keys['ArrowUp']; }
  get down() { return this.keys['KeyS'] || this.keys['ArrowDown']; }
  get left() { return this.keys['KeyA'] || this.keys['ArrowLeft']; }
  get right() { return this.keys['KeyD'] || this.keys['ArrowRight']; }

  _setupTouch() {
    const joy = document.getElementById('joystick');
    const knob = document.getElementById('joystick-knob');
    if (!joy) return;
    let id = null, cx = 0, cy = 0;
    const R = 38;

    const start = (e) => {
      const t = e.changedTouches[0];
      id = t.identifier;
      const r = joy.getBoundingClientRect();
      cx = r.left + r.width / 2; cy = r.top + r.height / 2;
      this.joyActive = true;
      move(e);
    };
    const move = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== id) continue;
        let dx = t.clientX - cx, dy = t.clientY - cy;
        const d = Math.hypot(dx, dy);
        if (d > R) { dx = dx / d * R; dy = dy / d * R; }
        this.joyX = dx / R;
        this.joyY = dy / R;
        knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      }
      e.preventDefault();
    };
    const end = () => {
      id = null; this.joyActive = false;
      this.joyX = 0; this.joyY = 0;
      knob.style.transform = 'translate(-50%, -50%)';
    };
    joy.addEventListener('touchstart', start, { passive: false });
    joy.addEventListener('touchmove', move, { passive: false });
    joy.addEventListener('touchend', end);
    joy.addEventListener('touchcancel', end);

    const bind = (el, prop) => {
      el.addEventListener('touchstart', (e) => { this[prop] = true; e.preventDefault(); }, { passive: false });
    };
    bind(document.getElementById('btn-place'), 'placePressed');
    bind(document.getElementById('btn-remove'), 'removePressed');
    bind(document.getElementById('btn-cycle'), 'cyclePressed');
  }

  consume() {
    const p = this.placePressed; this.placePressed = false;
    const r = this.removePressed; this.removePressed = false;
    const c = this.cyclePressed; this.cyclePressed = false;
    return { place: p, remove: r, cycle: c };
  }
}

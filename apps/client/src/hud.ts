import { type ShipClass, SHIP_CLASSES, SHIP_CLASS_ORDER } from '@tidebound/shared';
import { CLASS_NAMES } from './ships';

export interface HudActions {
  ready(): void;
  nextShip(): void;
  toggleMap(): void;
  toggleShip(): void;
  toggleAim(): void;
  toggleSound(): void;
  move(dx: number, dy: number): void;
  restart(): void;
}

export interface ShipCard {
  cls: ShipClass;
  cell: string;
  shots: number;
  maxShots: number;
  move: string;
  damaged: number;
}

const $ = <T extends HTMLElement>(root: ParentNode, sel: string) => root.querySelector(sel) as T;

/** The DOM overlay over the 3D canvas. */
export class Hud {
  private readonly root: HTMLElement;
  private readonly logEl: HTMLElement;

  constructor(parent: HTMLElement, actions: HudActions) {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.root.innerHTML = `
      <div class="top">
        <div class="brand">Tidebound <span>offline slice</span></div>
        <div class="round"><div class="round-label"></div><div class="bar"><div class="fill"></div></div></div>
        <div class="views">
          <button data-act="map" title="Both islands (M)">Map <kbd>M</kbd></button>
          <button data-act="ship" title="Behind your ship (V)">Ship <kbd>V</kbd></button>
          <button data-act="aim" title="Enemy island close-up (F)">Aim <kbd>F</kbd></button>
          <button data-act="sound" class="sound" title="Sound on/off (N)">🔊</button>
        </div>
      </div>
      <div class="enemy"><div class="enemy-title">Enemy fleet afloat</div><div class="enemy-list"></div></div>
      <ol class="log"></ol>
      <div class="cell-label"></div>
      <div class="bottom">
        <div class="card">
          <div class="card-name"></div>
          <div class="card-info"></div>
          <button data-act="next" class="small">Next ship <kbd>Tab</kbd></button>
        </div>
        <div class="pad">
          <button data-move="0,-1" aria-label="Move up">▲</button>
          <button data-move="-1,0" aria-label="Move left">◀</button>
          <button data-move="1,0" aria-label="Move right">▶</button>
          <button data-move="0,1" aria-label="Move down">▼</button>
        </div>
        <button data-act="ready" class="fire">Fire! <kbd>Space</kbd></button>
      </div>
      <div class="banner hidden"><div class="banner-title"></div><div class="banner-sub"></div><button data-act="restart">Play again</button></div>
      <div class="help">
        Your fleet is on the left island. Click the enemy lagoon on the right to aim (the Ironclad fires twice) ·
        WASD / arrows: plan a move · Tab: next ship · M / V / F: views · wheel: zoom · <b>Space: fire</b>
        <button class="help-close" aria-label="Close help">✕</button>
      </div>`;
    parent.appendChild(this.root);
    this.logEl = $(this.root, '.log');

    this.root.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('button');
      if (!btn) return;
      e.stopPropagation();
      const act = btn.dataset['act'];
      const mv = btn.dataset['move'];
      if (btn.classList.contains('help-close')) $(this.root, '.help').remove();
      else if (act === 'ready') actions.ready();
      else if (act === 'next') actions.nextShip();
      else if (act === 'map') actions.toggleMap();
      else if (act === 'aim') actions.toggleAim();
      else if (act === 'ship') actions.toggleShip();
      else if (act === 'sound') actions.toggleSound();
      else if (act === 'restart') actions.restart();
      else if (mv) {
        const [dx, dy] = mv.split(',').map(Number) as [number, number];
        actions.move(dx, dy);
      }
      btn.blur();
    });
    // Keep pointer events on the HUD from reaching the 3D scene.
    for (const ev of ['pointerdown', 'pointerup', 'wheel'] as const) {
      this.root.addEventListener(ev, (e) => {
        if ((e.target as HTMLElement).closest('button, .card, .log, .help')) e.stopPropagation();
      });
    }
  }

  setRound(round: number, phase: 'plan' | 'resolve' | 'over', remaining: number, total: number): void {
    $(this.root, '.round-label').textContent =
      phase === 'plan' ? `Round ${round} · plan · ${Math.ceil(remaining)} s` : phase === 'over' ? 'Match over' : `Round ${round} · firing…`;
    $(this.root, '.fill').style.width = `${phase === 'plan' ? (remaining / total) * 100 : 0}%`;
    $<HTMLButtonElement>(this.root, '.fire').disabled = phase !== 'plan';
  }

  setShots(planned: number, available: number): void {
    $(this.root, '.fire').innerHTML = `Fire! ${planned}/${available} <kbd>Space</kbd>`;
  }

  setCard(card: ShipCard): void {
    const spec = SHIP_CLASSES[card.cls];
    $(this.root, '.card-name').textContent = `${CLASS_NAMES[card.cls]} · ${card.cell}`;
    $(this.root, '.card-info').innerHTML =
      `${'▮'.repeat(spec.size - card.damaged)}${'<i>▮</i>'.repeat(card.damaged)} · shots ${card.shots}/${card.maxShots} · move ${card.move}`;
  }

  setEnemy(afloat: Record<ShipClass, number>): void {
    $(this.root, '.enemy-list').innerHTML = SHIP_CLASS_ORDER.map(
      (cls) =>
        `<div class="${afloat[cls] === 0 ? 'gone' : ''}"><span>${CLASS_NAMES[cls]}</span> <b>${'▮'.repeat(SHIP_CLASSES[cls].size)}</b> ×${afloat[cls]}</div>`,
    ).join('');
  }

  setCellLabel(text: string | null): void {
    const el = $(this.root, '.cell-label');
    el.textContent = text ?? '';
    el.classList.toggle('hidden', !text);
  }

  setViews(mode: string): void {
    $(this.root, '[data-act="aim"]').classList.toggle('on', mode === 'aim');
    $(this.root, '[data-act="map"]').classList.toggle('on', mode === 'overview');
    $(this.root, '[data-act="ship"]').classList.toggle('on', mode === 'chase');
  }

  setMuted(muted: boolean): void {
    $(this.root, '[data-act="sound"]').textContent = muted ? '🔇' : '🔊';
  }

  log(text: string, kind: 'miss' | 'hit' | 'sunk' | 'info'): void {
    const li = document.createElement('li');
    li.className = kind;
    li.textContent = text;
    this.logEl.prepend(li);
    while (this.logEl.children.length > 7) this.logEl.lastElementChild?.remove();
  }

  clearLog(): void {
    this.logEl.innerHTML = '';
  }

  banner(title: string | null, sub = ''): void {
    const b = $(this.root, '.banner');
    b.classList.toggle('hidden', title === null);
    $(this.root, '.banner-title').textContent = title ?? '';
    $(this.root, '.banner-sub').textContent = sub;
  }
}

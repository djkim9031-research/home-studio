import { fmtClock, horizonAltDeg, moonState, moonTimes, phaseName, sunPosition, sunTimes, twilightTimes } from '../scene/sun';

export interface SunPanelState {
  enabled: boolean;
  date: string; // YYYY-MM-DD, site-local
  minutes: number; // minutes after midnight, site-local
  clouds: boolean;
  cloudPct: number;
}

const KEY = 'hs:sun';

function todayLocal(): { date: string; minutes: number } {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    minutes: now.getHours() * 60 + now.getMinutes(),
  };
}

function parseTime(text: string): number | null {
  const m = text.trim().match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (mm > 59) return null;
  const ap = m[3]?.toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  if (h > 23) return null;
  return h * 60 + mm;
}

function parseDate(text: string): string | null {
  const m = text.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return null;
  const y = +m[1];
  const mo = +m[2];
  const d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${y}-${pad(mo)}-${pad(d)}`;
}

export interface SunPanel {
  state(): SunPanelState;
  set(patch: Partial<SunPanelState>): void;
}

export function buildSunPanel(
  root: HTMLElement,
  onChange: (s: SunPanelState) => void,
): SunPanel {
  let s: SunPanelState = { enabled: true, clouds: false, cloudPct: 30, ...todayLocal() };
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) s = { ...s, ...(JSON.parse(saved) as Partial<SunPanelState>) };
  } catch {
    /* ignore */
  }

  const panel = document.createElement('div');
  panel.className = 'sun-panel';
  root.appendChild(panel);

  panel.innerHTML = `
    <div class="sun-head">
      <span>☀ Sunlight</span>
      <span style="display:flex;gap:8px;align-items:center;">
        <label class="sun-toggle"><input type="checkbox" data-k="enabled"> real sun</label>
        <button class="hs-collapse" data-k="collapse" title="Collapse">▾</button>
      </span>
    </div>
    <div class="sun-body" data-k="body">
      <div class="sun-row">
        <input type="text" data-k="date" class="sun-input" size="10" title="Date (YYYY-MM-DD)">
        <input type="text" data-k="time" class="sun-input" size="8" title="Time, e.g. 17:30 or 5:30 pm">
      </div>
      <input type="range" data-k="slider" min="0" max="1439" step="5" class="sun-slider" title="Time of day">
      <div class="sun-info" data-k="info"></div>
      <div class="sun-row">
        <label class="sun-toggle"><input type="checkbox" data-k="clouds"> clouds</label>
        <input type="range" data-k="cloudPct" min="0" max="100" step="5" class="sun-slider cloud-slider">
        <span class="sun-pct" data-k="pct"></span>
      </div>
    </div>`;
  {
    const body = panel.querySelector('[data-k="body"]') as HTMLElement;
    const cbtn = panel.querySelector('[data-k="collapse"]') as HTMLButtonElement;
    cbtn.addEventListener('click', () => {
      const hidden = body.style.display === 'none';
      body.style.display = hidden ? '' : 'none';
      cbtn.textContent = hidden ? '▾' : '▸';
    });
  }

  const el = <T extends HTMLElement>(k: string): T => panel.querySelector(`[data-k="${k}"]`) as T;
  const enabledEl = el<HTMLInputElement>('enabled');
  const dateEl = el<HTMLInputElement>('date');
  const timeEl = el<HTMLInputElement>('time');
  const sliderEl = el<HTMLInputElement>('slider');
  const infoEl = el<HTMLDivElement>('info');
  const cloudsEl = el<HTMLInputElement>('clouds');
  const cloudPctEl = el<HTMLInputElement>('cloudPct');
  const pctEl = el<HTMLSpanElement>('pct');

  const fmtTimeInput = (min: number) =>
    `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

  const render = (): void => {
    enabledEl.checked = s.enabled;
    dateEl.value = s.date;
    timeEl.value = fmtTimeInput(s.minutes);
    sliderEl.value = String(s.minutes);
    cloudsEl.checked = s.clouds;
    cloudPctEl.value = String(s.cloudPct);
    pctEl.textContent = `${s.cloudPct}%`;
    dateEl.disabled = timeEl.disabled = sliderEl.disabled = !s.enabled;
    cloudsEl.disabled = cloudPctEl.disabled = !s.enabled;
    if (s.enabled) {
      const t = sunTimes(s.date);
      const tw = twilightTimes(s.date);
      const pos = sunPosition(s.date, s.minutes);
      const eff = pos.altitudeDeg - horizonAltDeg(pos.azimuthDeg);
      const state =
        eff >= 0
          ? `alt ${pos.altitudeDeg.toFixed(0)}° · az ${pos.azimuthDeg.toFixed(0)}°`
          : pos.altitudeDeg >= 0
            ? 'behind the horizon'
            : phaseName(pos.altitudeDeg);
      const mt = moonTimes(s.date);
      const ms = moonState(s.date, s.minutes);
      infoEl.textContent =
        `☼ ${fmtClock(t.sunrise)} → ${fmtClock(t.sunset)} · dusk ${fmtClock(tw.civilDusk)} · ${state}\n` +
        `☾ ${fmtClock(mt.rise)} → ${fmtClock(mt.set)} · ${ms.emoji} ${ms.phaseLabel} · ${Math.round(ms.fraction * 100)}% lit`;
    } else {
      infoEl.textContent = 'showcase lighting';
    }
  };

  const commit = (): void => {
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      /* ignore */
    }
    render();
    onChange(s);
  };

  enabledEl.addEventListener('change', () => {
    s.enabled = enabledEl.checked;
    commit();
  });
  dateEl.addEventListener('change', () => {
    const d = parseDate(dateEl.value);
    if (d) s.date = d;
    commit();
  });
  timeEl.addEventListener('change', () => {
    const t = parseTime(timeEl.value);
    if (t !== null) s.minutes = t;
    commit();
  });
  sliderEl.addEventListener('input', () => {
    s.minutes = parseInt(sliderEl.value, 10);
    commit();
  });
  cloudsEl.addEventListener('change', () => {
    s.clouds = cloudsEl.checked;
    commit();
  });
  cloudPctEl.addEventListener('input', () => {
    s.cloudPct = parseInt(cloudPctEl.value, 10);
    commit();
  });

  render();
  onChange(s);
  return {
    state: () => s,
    set(patch) {
      s = { ...s, ...patch };
      commit();
    },
  };
}

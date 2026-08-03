import * as store from '../state/store';
import type { CameraRig } from '../scene/camera';
import type { PointerController } from './pointer';

/** Global build-mode keys. Never steals from form fields. */
export function installKeyboard(rig: CameraRig, pointer: PointerController, onToolDone: () => void): void {
  window.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) store.redo();
      else store.undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      store.redo();
      return;
    }

    switch (e.key) {
      case 'Escape': {
        if (pointer.activeTool()) {
          pointer.setTool(null);
          onToolDone();
        } else {
          store.select(null);
        }
        break;
      }
      case 'Delete':
      case 'Backspace': {
        const ids = store.getState().selectedIds;
        if (ids.length) {
          e.preventDefault();
          store.deleteElements(ids);
        }
        break;
      }
      case 't':
      case 'T':
        rig.toTopView();
        break;
      case 'o':
      case 'O':
        rig.toDefaultView();
        break;
      case 'q':
      case 'Q':
      case 'r':
      case 'R': {
        // rotate the selected stair (Q = counter-clockwise, R = clockwise)
        const s = store.getState();
        const el = s.elements.find((x) => x.id === s.selectedId);
        if (el && el.kind === 'stair') {
          e.preventDefault();
          const dir = e.key === 'q' || e.key === 'Q' ? -1 : 1;
          store.updateElement(el.id, { yawDeg: (el.yawDeg + dir * 15 + 360) % 360 });
        }
        break;
      }
    }
  });
}

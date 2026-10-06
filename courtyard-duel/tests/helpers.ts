import { BTN } from '../src/shared/config';
import { Cmd, PlayerState, SimEvent, createPlayerState, stepPlayer } from '../src/shared/player';
import { World } from '../src/shared/world';
import { MAP } from '../src/shared/map';

export const world = new World(MAP);

export function newPlayer(x: number, z: number, y = 0, yaw = 0, primary: any = 'ak47', pistol: any = 'glock'): PlayerState {
  return createPlayerState({ x, y, z, yaw }, { primary, pistol }, 12345);
}

let seq = 0;
export function cmd(buttons: number, yaw = 0, pitch = 0, slot = -1, rt = 0): Cmd {
  return { seq: ++seq, buttons, yaw, pitch, slot, rt };
}

export function run(p: PlayerState, ticks: number, buttons: number, yaw = 0, pitch = 0, events: SimEvent[] = []): SimEvent[] {
  for (let i = 0; i < ticks; i++) stepPlayer(p, cmd(buttons, yaw, pitch), world, { frozen: false }, events);
  return events;
}
export { BTN };

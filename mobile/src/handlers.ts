// Map every tool name in your tools/my_tools.json to a native handler.
// Names MUST match exactly (case-sensitive, snake_case).

import { NativeModules, Platform } from 'react-native';

const { SmartHome, MediaPlayer, Timer, Climate } = NativeModules;

export type ToolName =
  | 'set_light_brightness'
  | 'play_music'
  | 'control_playback'
  | 'set_thermostat'
  | 'lock_door'
  | 'set_timer'
  | 'set_alarm'
  | 'set_reminder'
  | 'control_tv'
  | 'activate_scene';

export const handlers: Record<ToolName, (args: any) => Promise<any>> = {
  set_light_brightness: ({ room, level }) =>
    SmartHome.setBrightness(room, level),

  play_music: ({ genre, artist, song }) =>
    MediaPlayer.play({ genre, artist, song }),

  control_playback: ({ action, volume }) =>
    MediaPlayer.control(action, volume),

  set_thermostat: ({ temperature, mode }) =>
    Climate.set({ temperature, mode }),

  lock_door: ({ door, locked }) =>
    SmartHome.lockDoor(door, locked),

  set_timer: ({ minutes, label }) =>
    Timer.start(minutes * 60, label ?? ''),

  set_alarm: ({ time, label }) =>
    Timer.setAlarm(time, label ?? ''),

  set_reminder: ({ when, text }) =>
    Timer.reminder(when, text),

  control_tv: ({ power, input }) =>
    SmartHome.tv({ power, input }),

  activate_scene: ({ scene }) =>
    SmartHome.scene(scene),
};

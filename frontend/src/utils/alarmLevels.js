// Alarm progression and planning guidance supplied for the dispatch dashboard.
export const ALARM_LEVELS = [
  { level: '1st Alarm', trucks: '4 to 5', target: 4, control: 'BFP Station Crew / First Responders' },
  { level: '2nd Alarm', trucks: '6 to 7', target: 6, control: 'BFP District / City Headquarters' },
  { level: '3rd Alarm', trucks: '8 to 9', target: 8, control: 'BFP Provincial Operations' },
  { level: '4th Alarm', trucks: '10 to 11', target: 10, control: 'BFP Regional Director monitoring' },
  { level: '5th Alarm', trucks: '15 to 20', target: 15, control: 'National Headquarters notification' },
  { level: 'Task Force Alpha', trucks: '24', target: 24, control: 'Neighboring districts/cities activated' },
  { level: 'Task Force Bravo', trucks: '28', target: 28, control: 'Expanded regional containment crews' },
  { level: 'Task Force Charlie', trucks: '32', target: 32, control: 'Strategic provincial reinforcement' },
  { level: 'Task Force Delta', trucks: '36', target: 36, control: 'Large-scale multi-district response' },
  { level: 'Task Force Echo', trucks: '40', target: 40, control: 'Major critical area deployment' },
  { level: 'General Alarm', trucks: '44 to 80+', target: 44, control: 'All available units / Highest deployment' },
];

export const ALARMS = ALARM_LEVELS.map(({ level }) => level);
export const ALARM_ORDER = Object.fromEntries(ALARMS.map((level, index) => [level, index + 1]));
export const needsNeighboringSupport = level => (ALARM_ORDER[level] ?? 0) >= 3;

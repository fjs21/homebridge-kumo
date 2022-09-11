/** A fan state (speed) has multiple represenatations for use with different APIs. */
export interface FanState {
  /** Percent value used with HomeKit. */
  percent: number,
  /** Nueric index used with the Kumo cloud API. */
  value: number,
  /** Speed name used with the Kumo direct API. */
  name: string,
}
export const fanStates: FanState[] = [
  { percent: 0, value: 0, name: 'auto' },
  { percent: 20, value: 1, name: 'superQuiet' },
  { percent: 40, value: 2, name: 'quiet' },
  { percent: 60, value: 3, name: 'low' },
  //- not used - value: 4
  { percent: 80, value: 5, name: 'powerful' },
  { percent: 100, value: 6, name: 'superPowerful' },
];

/** Enables mapping between Kumo cloud, Kumo direct, and HomeKit representations of fan states. */
export const fanStateMap: { [key in number | string]: FanState} = {};

for (const fs of fanStates) {
  fanStateMap[fs.value] = fs;
  fanStateMap[fs.name] = fs;
  fanStateMap[fs.percent] = fs;
}

/**
 * Amount the HomeKit slider should "step". There are 5 speeds (aside from auto=0),
 * so each speed is a 20 percent step.
 * */
export const fanPercentStep = 20;


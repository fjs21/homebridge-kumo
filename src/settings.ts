/**
 * This is the name of the platform that users will use to register the plugin in the Homebridge config.json
 */
export const PLATFORM_NAME = 'Kumo';

/**
 * This must match the name of your plugin as defined the package.json
 */
export const PLUGIN_NAME = 'homebridge-kumo';

export const KUMO_LOGIN_URL = 'https://geo-c.kumocloud.com/login';

export const KUMO_DEVICE_UPDATES_URL = 'https://geo-c.kumocloud.com/getDeviceUpdates';

export const KUMO_DEVICE_INFREQUENT_UPDATES_URL = 'https://geo-c.kumocloud.com/getInfrequentDeviceUpdates';

export const KUMO_DEVICE_EXECUTE_URL = 'https://geo-c.kumocloud.com/sendDeviceCommands/v2';

export const KUMO_API_TOKEN_REFRESH_INTERVAL = 20;

// additional lag
export const KUMO_LAG = 10;

export const KUMO_KEY = '44c73283b498d432ff25f5c8e06a016aef931e68f0a00ea710e36e6338fb22db';

// do not poll device for fresh update more frequently than 2000ms
export const KUMO_DEVICE_WAIT = 5000;

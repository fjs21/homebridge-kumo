import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';

import { KumoApi } from './kumo-api';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';

import { KumoPlatformAccessory } from './platformAccessory';
import { KumoPlatformAccessory_ductless } from './ductless';
import { KumoPlatformAccessory_ductless_simple } from './ductless_simple';

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class KumoHomebridgePlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

  // this is used to track restored cached accessories
  public readonly accessories: PlatformAccessory[] = [];

  readonly kumo!: KumoApi;

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    // initializing login information
    this.log = log;

    // Initialize our connection to the Kumo API.
    this.kumo = new KumoApi(this.log, config.username, config.password);

    this.log.debug('Finished initializing platform:', this.config.name);

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', () => {
      this.log.debug('Executed didFinishLaunching callback');
      // run the method to discover / register your devices as accessories
      this.discoverDevices();
    });
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);

    // add the restored accessory to the accessories cache so we can track if it has already been registered
    this.accessories.push(accessory);
  }

  /**
   * This is an example method showing how to register discovered accessories.
   * Accessories must only be registered once, previously created accessories
   * must not be registered again to prevent "duplicate UUID" errors.
   */
  
  async discoverDevices() {

    // login to Kumo cloud and acquire security token
    let flag = await this.kumo.acquireSecurityToken();
    while (!flag) {
      this.log.error('Failed to login. Will retry in 10 secs.');
      await this.sleep(10000);
      flag = await this.kumo.acquireSecurityToken();
    }
    // config that login was succesful
    if(flag) {
      this.log.info('Completed login.');
    } else {
      this.log.error('Login failed. Aborting initialization.');
      return;
    }

    // loop over the discovered devices and register each one if it has not already been registered
    for (const device of this.kumo.devices) {

      // generate a unique id for the accessory this should be generated from
      // something globally unique, but constant, for example, the device serial
      // number or MAC address
      const uuid = this.api.hap.uuid.generate(device.serial);

      // see if an accessory with the same uuid has already been registered and restored from
      // the cached devices we stored in the `configureAccessory` method above
      const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);

      if (existingAccessory) {
        // the accessory already exists
        
        // Exclude or include certain openers based on configuration parameters.
        if(!this.optionEnabled(device)) {
          this.log.info('Removing accessory:', device.serial);
          this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
          continue;
        }

        this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);

        // if you need to update the accessory.context then you should run `api.updatePlatformAccessories`. eg.:
        existingAccessory.context.zoneTable = device.zoneTable;
        const overrideAddress = this.optionGetOverrideAddress(device);
        if (overrideAddress !== null) {
          this.log.info('Override address found for device - using IP %s instead of %s for direct access', overrideAddress, existingAccessory.context.zoneTable.address);
          device.overrideAddress = overrideAddress;
        }
        
        this.log.debug(device.zoneTable);

        if (this.config.directAccess) {
          existingAccessory.context.device = await this.kumo.queryDevice_Direct(device.serial);
          if(existingAccessory.context.device === null) {
            this.log.error('Failed to connect to device IP (%s) at %s', device.serial, device.overrideAddress ?? existingAccessory.context.zoneTable.address);
            existingAccessory.context.device = await this.kumo.queryDevice(device.serial);
            this.config.directAccess = false;
            this.log.info('Disabling directAccess to Kumo devices');
          } else {
            this.log.info('directAccess successful.');
          }
        } else {
          this.log.info('Using Kumo Cloud API for device control');
          existingAccessory.context.device = await this.kumo.queryDevice(device.serial);
        }
        
        this.log.debug(existingAccessory.context.device);

        //this.api.updatePlatformAccessories([existingAccessory]);

        // create the accessory handler for the restored accessory
        // this is imported from `platformAccessory.ts`
        if(existingAccessory.context.zoneTable.unitType === 'ductless' 
          || existingAccessory.context.zoneTable.unitType === 'mvz') {
          this.log.info('Initializing "%s" as ductless unit.', existingAccessory.displayName);
          if(this.config.simpleDuctless) {
            new KumoPlatformAccessory_ductless_simple(this, existingAccessory);
          } else {
            new KumoPlatformAccessory_ductless(this, existingAccessory);
          }
        } else {
          this.log.info('Initializing "%s" of unitType "%s" as generic (unspecified) unit.', 
            existingAccessory.displayName, existingAccessory.context.zoneTable.unitType);
          if(existingAccessory.context.device === undefined || existingAccessory.context.device === null){
            this.log.error('%s: No device information returned. Cannot initialize.', existingAccessory.displayName);
            continue;
          }
          // if we find cool and heat settings use ductless accessory
          if((existingAccessory.context.device.sp_heat !== undefined || existingAccessory.context.device.spHeat !== undefined) && (
            existingAccessory.context.device.sp_cool !== undefined || existingAccessory.context.device.spCool !== undefined)) {
            this.log.info('%s: Found heat and cool settings will use ductless accessory', existingAccessory.displayName);
            if(this.config.simpleDuctless) {
              new KumoPlatformAccessory_ductless_simple(this, existingAccessory);
            } else {
              new KumoPlatformAccessory_ductless(this, existingAccessory);
            }
          } else {         
            this.log.info('%s: Using platformaAccessory.ts accessory.', existingAccessory.displayName);
            new KumoPlatformAccessory(this, existingAccessory);
          }
        }
        
      } else {
        // the accessory does not yet exist, so we need to create it

        // Exclude or include certain openers based on configuration parameters.
        if(!this.optionEnabled(device)) {
          this.log.info('Skipping accessory:', device.serial);
          continue;
        }

        this.log.info('Adding new accessory:', device.label);

        // create a new accessory
        const accessory = new this.api.platformAccessory(device.label, uuid);

        // store a copy of the device object in the `accessory.context`
        // the `context` property can be used to store any data about the accessory you may need
        accessory.context.serial = device.serial;
        accessory.context.zoneTable = device.zoneTable;
        const overrideAddress = this.optionGetOverrideAddress(device);
        if (overrideAddress !== null) {
          this.log.info('Override address found for device - using IP %s instead of %s for direct access', overrideAddress, accessory.context.zoneTable.address);
          accessory.context.overrideAddress = overrideAddress;
        }
        
        this.log.debug(device.zoneTable);

        if (this.config.directAccess) {
          accessory.context.device = await this.kumo.queryDevice_Direct(device.serial);
          if(accessory.context.device === null) {
            this.log.error('Failed to connect to device IP (%s) at %s', device.serial, accessory.context.overrideAddress ?? accessory.context.zoneTable.address);
            this.config.directAccess = false;
            this.log.info('Disabling directAccess to Kumo devices');
            accessory.context.device = await this.kumo.queryDevice(device.serial);
          }
        } else {
          this.log.info('Using Kumo Cloud API for device control');
          accessory.context.device = await this.kumo.queryDevice(device.serial);
        }

        this.log.debug(accessory.context.device);
        
        // create the accessory handler for the newly create accessory
        // this is imported from `platformAccessory.ts`
        if(accessory.context.zoneTable.unitType === 'ductless' 
          || accessory.context.zoneTable.unitType === 'mvz') {
          this.log.info('Initializing "%s" as ductless unit.', device.label);
          if(this.config.simpleDuctless) {
            new KumoPlatformAccessory_ductless_simple(this, accessory);
          } else {
            new KumoPlatformAccessory_ductless(this, accessory);
          }
        } else {
          this.log.info('Initializing "%s" of unitType "%s" as generic (unspecified) unit.', 
            accessory.displayName, accessory.context.zoneTable.unitType);
          if(accessory.context.device === undefined || accessory.context.device === null){
            this.log.error('%s: No device information returned. Cannot initialize.', accessory.displayName);
            continue;
          }
          // if we find cool and heat settings use ductless accessory
          if((accessory.context.device.sp_heat !== undefined || accessory.context.device.spHeat !== undefined ) && (
            accessory.context.device.sp_cool !== undefined || accessory.context.device.spCool !== undefined )) {
            this.log.info('%s: Found heat and cool settings will use ductless accessory', accessory.displayName);
            if(this.config.simpleDuctless) {
              new KumoPlatformAccessory_ductless_simple(this, accessory);
            } else {
              new KumoPlatformAccessory_ductless(this, accessory);
            }
          } else {         
            this.log.info('%s: Using platformaAccessory.ts accessory.', accessory.displayName);
            new KumoPlatformAccessory(this, accessory);
          }
        }

        // link the accessory to your platform
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }

      // it is possible to remove platform accessories at any time using `api.unregisterPlatformAccessories`, eg.:
      // this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    }

  }

  // Modified from homebridge-myq
  // Utility function to let us know if a Kumo device should be visible in HomeKit or not.
  private optionEnabled(device, defaultReturnValue = true): boolean {

    // There are a couple of ways to hide and show devices that we support. The rules of the road are:
    //
    // 1. Explicitly hiding, or showing a gateway device propogates to all the devices that are plugged
    //    into that gateway. So if you have multiple gateways but only want one exposed in this plugin,
    //    you may do so by hiding it.
    //
    // 2. Explicitly hiding, or showing an opener device by its serial number will always override the above.
    //    This means that it's possible to hide a gateway, and all the openers that are attached to it, and then
    //    override that behavior on a single opener device that it's connected to.
    //

    // Nothing configured - we show all Kumo devices to HomeKit.
    if(!this.config.options) {
      return defaultReturnValue;
    }

    // We've explicitly enabled this device.
    if(this.config.options.indexOf('Enable.' + (device.serial)) !== -1) {
      return true;
    }

    // We've explicitly hidden this opener.
    if(this.config.options.indexOf('Disable.' + device.serial) !== -1) {
      return false;
    }

    // If we don't have a zoneTable label, we're done here.
    if(!device.label) {
      return true;
    }

    // We've explicitly shown the zoneTabel label this device is attached to.
    if(this.config.options.indexOf('Enable.' + device.label) !== -1) {
      return true;
    }

    // We've explicitly hidden the zoneTable label this device is attached to.
    if(this.config.options.indexOf('Disable.' + device.label) !== -1) {
      return false;
    }

    // Nothing special to do - make this opener visible.
    return defaultReturnValue;
  }
    
  // Utility function to let us know if we should use a different IP Address to communicate with a KUMO device.
  private optionGetOverrideAddress(device, defaultReturnValue = null): string|null {


    // Nothing configured - we show all Kumo devices to HomeKit.
    if(!this.config.options) {
      return defaultReturnValue;
    }

    // We've explicitly set an address for this device.
    for (const configOption of this.config.options) {
      if(configOption.startsWith('Address.' + (device.serial) + '=')) {
        return configOption.split('=')[1];
      }
    }
      
    // If we don't have a zoneTable label, we're done here.
    if(!device.label) {
      return defaultReturnValue;
    }

    // We've explicitly set an address for the zoneTable label this device is attached to.
    for (const configOption of this.config.options) {
      if(configOption.startsWith('Address.' + (device.label) + '=')) {
        return configOption.split('=')[1];
      }
    }

    // Nothing special to do - return default.
    return defaultReturnValue;
  }

  private sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

}

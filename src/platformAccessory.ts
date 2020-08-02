import { Service, PlatformAccessory, CharacteristicValue, CharacteristicSetCallback, CharacteristicGetCallback } from 'homebridge';

import { KumoHomebridgePlatform } from './platform';

import { KumoDevice } from "./kumo-api";

import { KUMO_LAG } from './settings';
/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class KumoPlatformAccessory {
  //private service: Service;
  private HeaterCooler: Service;
  private Fan: Service;
  private PowerSwitch: Service;

  private lastupdate;

  constructor(
    private readonly platform: KumoHomebridgePlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    
    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Default-Manufacturer')
      .setCharacteristic(this.platform.Characteristic.Model, 'Default-Model')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.accessory.context.serial);

    this.HeaterCooler = this.accessory.getService(this.platform.Service.HeaterCooler) || this.accessory.addService(this.platform.Service.HeaterCooler);
    this.Fan = this.accessory.getService(this.platform.Service.Fanv2) || this.accessory.addService(this.platform.Service.Fanv2);
    this.PowerSwitch = this.accessory.getService(this.platform.Service.Switch) || this.accessory.addService(this.platform.Service.Switch);

    // set sevice names.
    this.HeaterCooler.setCharacteristic(this.platform.Characteristic.Name, "Heater/Cooler");
    this.Fan.setCharacteristic(this.platform.Characteristic.Name, "Fan");
    this.PowerSwitch.setCharacteristic(this.platform.Characteristic.Name, "Power");

    // create handlers for characteristics
    this.HeaterCooler.getCharacteristic(this.platform.Characteristic.Active)
      .on('get', this.handleActiveGet.bind(this))
      .on('set', this.handleActiveSet.bind(this));

    this.HeaterCooler.getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState)
      .on('get', this.handleCurrentHeaterCoolerStateGet.bind(this));

    this.HeaterCooler.getCharacteristic(this.platform.Characteristic.TargetHeaterCoolerState)
      .on('get', this.handleTargetHeaterCoolerStateGet.bind(this))
      .on('set', this.handleTargetHeaterCoolerStateSet.bind(this));
    
    this.HeaterCooler.getCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature)
      .on('get', this.handleTargetHeaterCoolingThresholdTemperatureGet.bind(this))
      .on('set', this.handleTargetHeaterCoolingThresholdTemperatureSet.bind(this));

    this.HeaterCooler.getCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature)
      .on('get', this.handleTargetHeaterHeatingThresholdTemperatureGet.bind(this))
      .on('set', this.handleTargetHeaterHeatingThresholdTemperatureSet.bind(this));

    this.HeaterCooler.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .on('get', this.handleCurrentTemperatureGet.bind(this));   
  
    this.Fan.getCharacteristic(this.platform.Characteristic.Active)
      .on('get', this.handleFanActiveGet.bind(this))
      .on('set', this.handleFanActiveSet.bind(this));

    this.Fan.getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .on('get', this.handleFanRotationSpeedGet.bind(this))
      .on('set', this.handleFanRotationSpeedSet.bind(this));

    this.Fan.getCharacteristic(this.platform.Characteristic.SwingMode)
      .on('get', this.handleFanSwingModeGet.bind(this))
      .on('set', this.handleFanSwingModeSet.bind(this));

    this.PowerSwitch.getCharacteristic(this.platform.Characteristic.On)
      .on('get', this.handlePowerSwitchOnGet.bind(this))
      .on('set', this.handlePowerSwitchOnSet.bind(this));
  }
  
  // As Device updates take some time to update need to check before updating HAP with stale data.
  async updateDevice() {
    // queryDevice and update context.device depending on last contact/update.

    // queryDevice
    let device: any = await this.platform.kumo.queryDevice(this.platform.log, this.accessory.context.serial);   
    //this.platform.log.debug("seconds_since_contact",device.seconds_since_contact);

    // set last contact with device time and  add LAG to ensure command went through
    const lastcontact = Date.now() - ((device.seconds_since_contact + KUMO_LAG) * 1000);
    //this.platform.log.debug("lastcontact from device:", lastcontact);

    //this.platform.log.debug("last sent command to device:", this.lastupdate);

    if(lastcontact < this.lastupdate) {
      // last contact occured before last set operation
      this.platform.log.debug("No recent update from Kumo cloud")
      return false
    }  

    // update device contect
    this.accessory.context.device = device;          
    return true
  } 

  // handlers
  async handleActiveGet(callback) {
    await this.updateDevice();

    const operation_mode = this.accessory.context.device.operation_mode
    this.platform.log.debug("operation_mode: %s",operation_mode);

    let currentValue
    if (operation_mode == 16) {
      // Unit inactive
      currentValue = 0
    } else if (operation_mode == 7 || operation_mode == 2) {
      // Fan or Dehumidifier - set Active OFF
      currentValue = 0
    } else if (operation_mode == 8) {
      // Auto Mode
      currentValue = 1
    } else if (operation_mode == 1 || operation_mode == 33) {
      // Heating
      currentValue = 1
    } else if (operation_mode == 3 || operation_mode == 35) {
      // Cooling
      currentValue = 1
    }

    callback(null, currentValue);
  }

  /**
   * Handle requests to set the "Active" characteristic
   */
  handleActiveSet(value, callback) {
    this.platform.log.debug('Triggered SET Heater/Cooler Active:', value);

    let command
    if(value == 0) {
      command = {"power":0};
    }
    if(value == 1) {
      command = {"power":1};
    }

    this.platform.kumo.execute(this.accessory.context.serial, command)
    this.lastupdate = Date.now();
    callback(null);
  }

  // Handle requests to get the current value of the "Current Heater Cooler State" characteristic
  async handleCurrentHeaterCoolerStateGet(callback) {
    this.updateDevice();

    const operation_mode = this.accessory.context.device.operation_mode
    this.platform.log.debug("operation_mode: %s",operation_mode);
    
    let currentValue
    if (operation_mode == 16) {
      currentValue = this.platform.Characteristic.CurrentHeaterCoolerState.INACTIVE
    } else if (operation_mode == 7 || operation_mode == 2) {
      currentValue = this.platform.Characteristic.CurrentHeaterCoolerState.IDLE
    } else if (operation_mode == 1 || operation_mode == 33) {
      currentValue = this.platform.Characteristic.CurrentHeaterCoolerState.HEATING  
    } else if (operation_mode == 3 || operation_mode == 35) {
      currentValue = this.platform.Characteristic.CurrentHeaterCoolerState.COOLING
    }
    
    this.platform.log.debug('Triggered GET CurrentHeaterCoolerState', currentValue);
    callback(null, currentValue);
  }

  // Handle requests to get the current value of the "Target Heater Cooler State" characteristic
  async handleTargetHeaterCoolerStateGet(callback) {
    await this.updateDevice();

    const operation_mode = this.accessory.context.device.operation_mode
    this.platform.log.debug("operation_mode: %s",operation_mode);

    let currentValue
      if (operation_mode == 8 || operation_mode == 35 || operation_mode == 33) {
        currentValue = this.platform.Characteristic.TargetHeaterCoolerState.AUTO
      } else if (operation_mode == 1) {
        currentValue = this.platform.Characteristic.TargetHeaterCoolerState.HEAT 
      } else if (operation_mode == 3) {
        currentValue = this.platform.Characteristic.TargetHeaterCoolerState.COOL
      }

    this.platform.log.debug('Triggered GET TargetHeaterCoolerState', currentValue);
    callback(null, currentValue);
  }

  // Handle requests to set the "Target Heater Cooler State" characteristic
  handleTargetHeaterCoolerStateSet(value, callback) {
    this.platform.log.debug('Triggered SET TargetHeaterCoolerState:', value);

    this.PowerSwitch.updateCharacteristic(this.platform.Characteristic.Active, 1);
    let command
    if(value == this.platform.Characteristic.TargetHeaterCoolerState.AUTO) {
      command = {"power":1,"operationMode":8};
    }
    if(value == this.platform.Characteristic.TargetHeaterCoolerState.HEAT) {
      command = {"power":1,"operationMode":1};
    }
    if(value == this.platform.Characteristic.TargetHeaterCoolerState.COOL) {
      command = {"power":1,"operationMode":3};
    }
    
    this.platform.kumo.execute(this.accessory.context.serial, command);
    this.lastupdate = Date.now();
    callback(null);
  }  

  async handleTargetHeaterCoolingThresholdTemperatureGet(callback) {
    await this.updateDevice();

    // set this to a valid value for CurrentTemperature
    const currentValue = this.accessory.context.device.sp_cool;
    this.platform.log.debug('Triggered GET TargetHeaterCoolingThresholdTemperature', currentValue);

    callback(null, currentValue);
  }

  async handleTargetHeaterHeatingThresholdTemperatureGet(callback) {
    await this.updateDevice();

    // set this to a valid value for CurrentTemperature
    const currentValue = this.accessory.context.device.sp_heat;
    this.platform.log.debug('Triggered GET TargetHeaterHeatingThresholdTemperature', currentValue);
    
    callback(null, currentValue);
  }

  handleTargetHeaterCoolingThresholdTemperatureSet(value, callback) {
    this.platform.log.debug('Triggered SET TargetHeaterCoolingThresholdTemperature:', value);

    let command
    command = {"spCool":value};
    
    this.platform.kumo.execute(this.accessory.context.serial, command);
    this.lastupdate = Date.now();
    callback(null);
  }  

  handleTargetHeaterHeatingThresholdTemperatureSet(value, callback) {
    this.platform.log.debug('Triggered SET TargetHeaterHeatingThresholdTemperature:', value);

    let command
    command = {"spHeat":value};
    
    this.platform.kumo.execute(this.accessory.context.serial, command);
    this.lastupdate = Date.now();
    callback(null);
  }  

  async handleCurrentTemperatureGet(callback) {
    await this.updateDevice();

    // set this to a valid value for CurrentTemperature
    const currentValue = this.accessory.context.device.room_temp;
    this.platform.log.debug('Triggered GET CurrentTemperature', currentValue);

    callback(null, currentValue);
  }

  async handleFanActiveGet(callback) {
    await this.updateDevice();
    
    // retrieve fan_speed
    const fan_speed = this.accessory.context.device.fan_speed;
    
    let currentValue
    if(fan_speed>0) {
      currentValue=1
    } else {
      currentValue=0
    }
    this.platform.log.debug('Triggered GET Manual FanActive', currentValue);

    callback(null, currentValue);
  }

  handleFanActiveSet(value, callback) {
    this.platform.log.debug('Triggered SET Manual FanActive', value);

    let command;   
    if(value == 0) {
      // fan to auto
      command = {"fanSpeed":0};
    } else if(value == 1) {    
      // check power status
      if(this.accessory.context.device.power == 1) {
        // set fanSpeed
        command = {"fanSpeed":1};  
      } else {
        // set power to on, operationMode to 7 and fanSpeed
        command = {"power":1,"operationMode":7,"fanSpeed":1};
      }
    }

    this.platform.kumo.execute(this.accessory.context.serial, command);    
    this.lastupdate = Date.now();
    callback(null);
  }

  async handleFanRotationSpeedGet(callback) {
    await this.updateDevice();

    this.platform.log.debug("fan_speed:", this.accessory.context.device.fan_speed)

    const currentValue = (this.accessory.context.device.fan_speed - 1) * 20;
    this.platform.log.debug('Triggered GET handleFanRotationSpeed', currentValue);

    callback(null, currentValue);
  }

  handleFanRotationSpeedSet(value, callback) {
    let speed;
    speed = Math.floor(value / 20) + 1
    this.platform.log.debug('Triggered SET handleFanRotationSpeed', speed);
    
    let command;
    command = {"fanSpeed":speed};

    this.platform.kumo.execute(this.accessory.context.serial, command);    
    this.lastupdate = Date.now();
    callback(null);
  }

  async handleFanSwingModeGet(callback) {
    await this.updateDevice();

    // retrieve air_direction
    const air_direction = this.accessory.context.device.air_direction
    this.platform.log.debug("air_direction:", air_direction)

    let currentValue
    if(air_direction == 7) {
      currentValue = this.platform.Characteristic.SwingMode.SWING_ENABLED
    } else {
      currentValue = this.platform.Characteristic.SwingMode.SWING_DISABLED
    }

    callback(null, currentValue)
  }
  
  handleFanSwingModeSet (value, callback) {

    let command
    if(value == this.platform.Characteristic.SwingMode.SWING_ENABLED){
      command = {"airDirection":7};
    } else {
      command = {"airDirection":0};
    }

    this.platform.kumo.execute(this.accessory.context.serial, command); 
    this.lastupdate = Date.now();
    callback(null)
  }

  async handlePowerSwitchOnGet(callback) {
    await this.updateDevice();

    const currentValue = this.accessory.context.device.power;
    this.platform.log.debug('Triggered GET Power Active', currentValue);

    callback(null, currentValue)
  }

  handlePowerSwitchOnSet(value, callback) {
    this.platform.log.debug('Triggered SET Power Active:', value);

    let command
    if(value == 0) {
      command = {"power":0,"operationMode":16};
      // turn off other services to refect power off
      this.HeaterCooler.updateCharacteristic(this.platform.Characteristic.Active, 0);
      this.Fan.updateCharacteristic(this.platform.Characteristic.Active, 0);
      this.Fan.updateCharacteristic(this.platform.Characteristic.RotationSpeed, 0);
    }
    if(value == 1) {
      // turn on Fan with auto fanSpeed and airDirection
      command = {"power":1,"operationMode":7,"fanSpeed":0,"airDirection":0};
    }

    this.platform.kumo.execute(this.accessory.context.serial, command);
    this.lastupdate = Date.now();
    callback(null);
  }

}



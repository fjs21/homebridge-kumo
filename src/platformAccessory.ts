import { Service, PlatformAccessory, CharacteristicValue, CharacteristicSetCallback, CharacteristicGetCallback } from 'homebridge';

import { KumoHomebridgePlatform } from './platform';

import { KumoDevice } from "./kumo-api";

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class KumoPlatformAccessory {
  //private service: Service;
  private HeaterCooler: Service;
  private Fan: Service;

  constructor(
    private readonly platform: KumoHomebridgePlatform,
    private readonly accessory: PlatformAccessory,
    //private readonly HeaterCooler: PlatformAccessory,
    //private readonly Fan: PlatformAccessory,
  ) {
    //this.platform.log.info("Device: %s.", this.accessory.context.device)
    //this.platform.log.info("room_temp: %s.", this.accessory.context.device.room_temp)
    
    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Default-Manufacturer')
      .setCharacteristic(this.platform.Characteristic.Model, 'Default-Model')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.accessory.context.serial);

    this.HeaterCooler = this.accessory.getService(this.platform.Service.HeaterCooler) || this.accessory.addService(this.platform.Service.HeaterCooler)
    this.Fan = this.accessory.getService(this.platform.Service.Fanv2) || this.accessory.addService(this.platform.Service.Fanv2);

    // To avoid "Cannot add a Service with the same UUID another Service without also defining a unique 'subtype' property." error,
    // when creating multiple services of the same type, you need to use the following syntax to specify a name and subtype id:
    // this.accessory.getService('NAME') ?? this.accessory.addService(this.platform.Service.Lightbulb, 'NAME', 'USER_DEFINED_SUBTYPE');

    // set the service name, this is what is displayed as the default name on the Home app
    // in this example we are using the name we stored in the `accessory.context` in the `discoverDevices` method.
    this.HeaterCooler.setCharacteristic(this.platform.Characteristic.Name, accessory.displayName);
    this.Fan.setCharacteristic(this.platform.Characteristic.Name, accessory.displayName);

    // create handlers for required characteristics
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

    // Every 30 secs using and updated using the `updateCharacteristic` method. 
    setInterval(() => {
      this.updateDevice;
    }, 30000);
  }
   
  async updateDevice() {
    
      this.platform.log.debug("Run infrequent");
      this.platform.kumo.infrequentQuery(this.platform.log, this.accessory.context.serial)

      let device = await this.platform.kumo.queryDevice(this.platform.log, this.accessory.context.serial)
      if(device) {
        this.accessory.context.device = device; 
      }

      this.HeaterCooler.updateCharacteristic(this.platform.Characteristic.Active, this.accessory.context.device.power);

      this.HeaterCooler.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, this.accessory.context.device.room_temp);

      const operation_mode = this.accessory.context.device.operation_mode;
      let currentValue
      if (operation_mode == 16) {
        currentValue = this.platform.Characteristic.CurrentHeaterCoolerState.IDLE
      } else if (operation_mode == 1 || operation_mode == 33) {
        currentValue = this.platform.Characteristic.CurrentHeaterCoolerState.HEATING  
      } else if (operation_mode == 3 || operation_mode == 35) {
        currentValue = this.platform.Characteristic.CurrentHeaterCoolerState.COOLING
      }
      this.HeaterCooler.updateCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState, currentValue);

      if (operation_mode == 35 || operation_mode == 33) {
        currentValue = this.platform.Characteristic.TargetHeaterCoolerState.AUTO
      } else if (operation_mode == 1) {
        currentValue = this.platform.Characteristic.TargetHeaterCoolerState.HEAT 
      } else if (operation_mode == 3) {
        currentValue = this.platform.Characteristic.TargetHeaterCoolerState.COOL
      }
      this.HeaterCooler.updateCharacteristic(this.platform.Characteristic.TargetHeaterCoolerState, currentValue);

      this.HeaterCooler.updateCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature, this.accessory.context.device.sp_cool);

      this.HeaterCooler.updateCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature, this.accessory.context.device.sp_heat);      

      this.Fan.updateCharacteristic(this.platform.Characteristic.Active, this.accessory.context.device.power);  

      this.Fan.updateCharacteristic(this.platform.Characteristic.RotationSpeed, this.accessory.context.device.fan_speed*20);  

      //this.Fan.updateCharacteristic(this.platform.Characteristic.)  
  };

  /**
   * Handle the "GET" requests from HomeKit
   * These are sent when HomeKit wants to know the current state of the accessory, for example, checking if a Light bulb is on.
   * 
   * GET requests should return as fast as possbile. A long delay here will result in
   * HomeKit being unresponsive and a bad user experience in general.
   * 
   * If your device takes time to respond you should update the status of your device
   * asynchronously instead using the `updateCharacteristic` method instead.

   * @example
   * this.service.updateCharacteristic(this.platform.Characteristic.On, true)
   */
  /*
  getOn(callback: CharacteristicGetCallback) {

    // implement your own code to check if the device is on
    const isOn = this.exampleStates.On;

    this.platform.log.debug('Get Characteristic On ->', isOn);

    // you must call the callback function
    // the first argument should be null if there were no errors
    // the second argument should be the value to return
    callback(null, isOn);
  }
  */
/**
   * Handle requests to get the current value of the "Active" characteristic
   */
  
  handleActiveGet(callback) {
    // set this to a valid value for Active
    const currentValue = this.accessory.context.device.power;
    this.platform.log.debug('Triggered GET Active', currentValue);

    callback(null, currentValue);
  }

  /**
   * Handle requests to set the "Active" characteristic
   */
  handleActiveSet(value, callback) {
    this.platform.log.debug('Triggered SET Active:', value);

    let command
    if(value == 0) {
      command = {"power":0};
    }
    if(value == 1) {
      command = {"power":1};
    }
    this.platform.kumo.execute(this.accessory.context.serial, command)

    callback(null);
  }

  /**
   * Handle requests to get the current value of the "Current Heater Cooler State" characteristic
   */
  async handleCurrentHeaterCoolerStateGet(callback) {
    // update information
    let device = await this.platform.kumo.queryDevice(this.platform.log, this.accessory.context.serial)
    if(device) {
      this.accessory.context.device = device; 
    }

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

  /**
   * Handle requests to get the current value of the "Target Heater Cooler State" characteristic
   */
  async handleTargetHeaterCoolerStateGet(callback) {
    // update information
    let device = await this.platform.kumo.queryDevice(this.platform.log, this.accessory.context.serial)
    if(device) {
      this.accessory.context.device = device; 
    }

    const operation_mode = this.accessory.context.device.operation_mode
    this.platform.log.debug("operation_mode: %s",operation_mode);

    let currentValue
      if (operation_mode == 7 || operation_mode == 35 || operation_mode == 33) {
        currentValue = this.platform.Characteristic.TargetHeaterCoolerState.AUTO
      } else if (operation_mode == 1) {
        currentValue = this.platform.Characteristic.TargetHeaterCoolerState.HEAT 
      } else if (operation_mode == 3) {
        currentValue = this.platform.Characteristic.TargetHeaterCoolerState.COOL
      }

    this.platform.log.debug('Triggered GET TargetHeaterCoolerState', currentValue);
    callback(null, currentValue);
  }

  /**
   * Handle requests to set the "Target Heater Cooler State" characteristic
   */
  handleTargetHeaterCoolerStateSet(value, callback) {
    this.platform.log.debug('Triggered SET TargetHeaterCoolerState:', value);

    let command
    if(value == this.platform.Characteristic.TargetHeaterCoolerState.AUTO) {
      command = {"power":1,"operationMode":8}
    }
    if(value == this.platform.Characteristic.TargetHeaterCoolerState.HEAT) {
      command = {"power":1,"operationMode":1};
    }
    if(value == this.platform.Characteristic.TargetHeaterCoolerState.COOL) {
      command = {"power":1,"operationMode":3};
    }
    this.platform.kumo.execute(this.accessory.context.serial, command);

    callback(null);
  }  

  async handleTargetHeaterCoolingThresholdTemperatureGet(callback) {
    // update information
    let device = await this.platform.kumo.queryDevice(this.platform.log, this.accessory.context.serial)
    if(device) {
      this.accessory.context.device = device; 
    }

    // set this to a valid value for CurrentTemperature
    const currentValue = this.accessory.context.device.sp_cool;
    this.platform.log.debug('Triggered GET TargetHeaterCoolingThresholdTemperature', currentValue);

    callback(null, currentValue);
  }

  async handleTargetHeaterHeatingThresholdTemperatureGet(callback) {
    // update information
    let device = await this.platform.kumo.queryDevice(this.platform.log, this.accessory.context.serial)
    if(device) {
      this.accessory.context.device = device; 
    }

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

    callback(null);
  }  

  handleTargetHeaterHeatingThresholdTemperatureSet(value, callback) {
    this.platform.log.debug('Triggered SET TargetHeaterHeatingThresholdTemperature:', value);

    let command
    command = {"spHeat":value};
    
    this.platform.kumo.execute(this.accessory.context.serial, command);

    callback(null);
  }  

  async handleCurrentTemperatureGet(callback) {
    // update information
    let device = await this.platform.kumo.queryDevice(this.platform.log, this.accessory.context.serial)
    if(device) {
      this.accessory.context.device = device; 
    }

    // set this to a valid value for CurrentTemperature
    const currentValue = this.accessory.context.device.room_temp;
    this.platform.log.debug('Triggered GET CurrentTemperature', currentValue);

    callback(null, currentValue);
  }

  handleFanActiveGet(callback) {
    const currentValue = this.accessory.context.device.power;
    this.platform.log.debug('Triggered GET FanActive', currentValue);

    callback(null, currentValue);
  }

  handleFanActiveSet(value, callback) {
    this.platform.log.debug('Triggered SET FanActive', value);

    callback(null);
  }

  handleFanRotationSpeedGet(callback) {
    const currentValue = this.accessory.context.device.fan_speed * 20;
    this.platform.log.debug('Triggered GET handleFanRotationSpeed', currentValue);

    callback(null, currentValue);
  }

  handleFanRotationSpeedSet(value, callback) {
    let speed;
    speed = Math.floor(value / 20) 
    this.platform.log.debug('Triggered SET handleFanRotationSpeed', speed);
    
    let command;
    command = {fanSpeed:speed};

    this.platform.kumo.execute(this.accessory.context.serial, command);    

    callback(null);
  }

}



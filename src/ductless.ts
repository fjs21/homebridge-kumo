import { Service, PlatformAccessory } from 'homebridge';

import fakegato from 'fakegato-history';

import { KumoDevice, KumoDeviceDirect } from './kumo-api';

import { KumoHomebridgePlatform } from './platform';

import { KUMO_LAG, KUMO_DEVICE_WAIT } from './settings';

import { FanState, fanStateMap, fanPercentStep } from './fanState';

/*
 * Platform Accessory - Kumo 'ductless' accessory tested with a
 * Mitsubishi split-system heat pump (minisplit) Model MSZ-FH12NA coupled with a PAC-USWHS002-WF-2 WiFi module
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class KumoPlatformAccessory_ductless {
  //private service: Service;
  private HeaterCooler: Service;
  private Fan: Service;
  private Dehumidifier: Service;
  private Humidity: Service | null;
  private HumidityBattery: Service | null;


  private lastupdate;
  private lastquery;

  private directAccess;

  private historyService: fakegato.FakeGatoHistoryService;

  constructor(
    private readonly platform: KumoHomebridgePlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    this.directAccess = this.platform.config.directAccess;

    const useExternalSensor = this.directAccess &&
      this.accessory.context.device.activeThermistor !== undefined &&
      this.accessory.context.device.activeThermistor !== 'unset';

    if (useExternalSensor) {
      this.platform.log.info('device %s uses external sensor %s',
        this.accessory.context.serial,
        this.accessory.context.device.activeThermistor);
    }

    // determine device profile and additional sensors to tailor accessory to
    // the capabilities of the kumo device
    // (not yet implemented)
    /*
    if(this.directAccess) {
      this.platform.kumo.queryDeviceProfile_Direct(this.accessory.context.serial);

      this.platform.kumo.queryDeviceSensors_Direct(this.accessory.context.serial);

      this.platform.kumo.queryDeviceAdapter_Direct(this.accessory.context.serial);
    }
    */

    // set accessory information
    
    if (accessory.context.zoneTable.unitType !== undefined && accessory.context.zoneTable.unitType !== null) {
      const unitType: string = this.accessory.context.zoneTable.unitType;
      this.accessory.getService(this.platform.Service.AccessoryInformation)!
        .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Mitsubishi')
        .setCharacteristic(this.platform.Characteristic.SerialNumber, this.accessory.context.serial)
        .setCharacteristic(this.platform.Characteristic.Model, unitType);
    } else {
      this.accessory.getService(this.platform.Service.AccessoryInformation)!
        .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Mitsubishi')
        .setCharacteristic(this.platform.Characteristic.SerialNumber, this.accessory.context.serial)
        .setCharacteristic(this.platform.Characteristic.Model, 'unknown using ductless');
    }

    this.HeaterCooler = this.accessory.getService(
      this.platform.Service.HeaterCooler) || this.accessory.addService(this.platform.Service.HeaterCooler);
    this.Fan = this.accessory.getService(this.platform.Service.Fanv2) || this.accessory.addService(this.platform.Service.Fanv2);

    /* Implement dehumidifer as seperate switch as minisplit does not have humidity measuerment */
    this.Dehumidifier = this.accessory.getService('Dehumidifier') || 
      this.accessory.addService(this.platform.Service.Switch, 'Dehumidifier', 'Dehumidifier');

    //  this.platform.Service.HumidifierDehumidifier) || this.accessory.addService(this.platform.Service.HumidifierDehumidifier);

    // set sevice names.
    this.HeaterCooler.setCharacteristic(this.platform.Characteristic.Name, 'Heater/Cooler');
    this.Fan.setCharacteristic(this.platform.Characteristic.Name, 'Fan');

    this.Humidity = useExternalSensor ? this.accessory.getService(
      this.platform.Service.HumiditySensor) || this.accessory.addService(this.platform.Service.HumiditySensor) : null;

    this.HumidityBattery = useExternalSensor ? this.accessory.getService(
      this.platform.Service.Battery) || this.accessory.addService(this.platform.Service.Battery) : null;

    if (this.Humidity) {
      this.Humidity.setCharacteristic(this.platform.Characteristic.Name, 'Humidity Sensor');
    }

    if (this.HumidityBattery) {
      this.HumidityBattery.setCharacteristic(this.platform.Characteristic.Name, 'Humidity Sensor Battery');
      this.HumidityBattery.setCharacteristic(this.platform.Characteristic.ChargingState, this.platform.Characteristic.ChargingState.NOT_CHARGEABLE);
    }

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
  
    this.HeaterCooler.getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .setProps({ minStep: fanPercentStep })
      // .on('get', this.handleFanRotationSpeedGet.bind(this))
      .on('set', this.handleFanRotationSpeedSet.bind(this));

    this.HeaterCooler.getCharacteristic(this.platform.Characteristic.SwingMode)
      // .on('get', this.handleFanSwingModeGet.bind(this))
      .on('set', this.handleFanSwingModeSet.bind(this));

    /* Device - Fan */
    this.Fan.getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .setProps({ minStep: fanPercentStep })
      .on('get', this.handleFanRotationSpeedGet.bind(this))
      .on('set', this.handleFanRotationSpeedSet.bind(this));

    this.Fan.getCharacteristic(this.platform.Characteristic.SwingMode)
      .on('get', this.handleFanSwingModeGet.bind(this))
      .on('set', this.handleFanSwingModeSet.bind(this));

    this.Fan.getCharacteristic(this.platform.Characteristic.Active)
      .on('get', this.handleFanActiveGet.bind(this))
      .on('set', this.handleFanActiveSet.bind(this));

    /* Device - Dehumidifer */
    this.Dehumidifier.getCharacteristic(this.platform.Characteristic.On)
      .on('get', this.handleDehumidifierSwitchGet.bind(this))
      .on('set', this.handleDehumidifierSwitchSet.bind(this));

    // this.Dehumidifier.getCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity)
    //   .on('get', this.handleDehumidiferCurrentRelativeHumidityGet.bind(this));
      
    // this.Dehumidifier.getCharacteristic(this.platform.Characteristic.CurrentHumidifierDehumidifierState)
    //   .on('get', this.handleDehumidiferCurrentHumidifierDehumidifierStateGet.bind(this));    

    // this.Dehumidifier.getCharacteristic(this.platform.Characteristic.TargetHumidifierDehumidifierState)
    //   .on('get', this.handleDehumidiferTargetHumidifierDehumidifierStateGet.bind(this))
    //   .on('set', this.handleDehumidiferTargetHumidifierDehumidifierStateSet.bind(this));

    // this.Dehumidifier.getCharacteristic(this.platform.Characteristic.Active)
    //   .on('get', this.handleDehumidiferActiveGet.bind(this))
    //   .on('set', this.handleDehumidiferActiveSet.bind(this));

    if (this.Humidity) {
      this.Humidity.getCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity)
        .on('get', this.handleHumidityGet.bind(this));
    }

    this.updateDevice();

    // setup interval for updating device for historyService
    const historyInterval = 10; // history interval in minutes

    const FakeGatoHistoryService = fakegato(this.platform.api);
    this.historyService = new FakeGatoHistoryService('weather', this.accessory, {
      storage: 'fs',
      minutes: historyInterval,
    });
    this.historyService.name = this.HeaterCooler.getCharacteristic(this.platform.Characteristic.CurrentTemperature);
    //this.historyService.log = this.platform.log; // swicthed off to prevent flooding the log

    setInterval(() => {
      this.platform.log.debug('%s: Running interval', this.accessory.displayName);
      this.updateAccessoryCharacteristics();
    }, 1000 * 60 * historyInterval);
  }

  /* handlers GET */

  /* Generic handler - disabled as callback value is required */
  // async handleGet(callback) {
  //   await this.updateAccessoryCharacteristics();
  //   callback(null);
  // }

  async handleActiveGet(callback) {
    await this.updateAccessoryCharacteristics();
    callback(null, this.HeaterCooler.getCharacteristic(this.platform.Characteristic.Active).value);
  }

  async handleCurrentHeaterCoolerStateGet(callback) {
    await this.updateAccessoryCharacteristics();
    callback(null, this.HeaterCooler.getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState).value);
  }

  async handleTargetHeaterCoolerStateGet(callback) {
    await this.updateAccessoryCharacteristics();
    callback(null, this.HeaterCooler.getCharacteristic(this.platform.Characteristic.TargetHeaterCoolerState).value);
  }

  async handleTargetHeaterCoolingThresholdTemperatureGet(callback) {
    await this.updateAccessoryCharacteristics();
    callback(null, this.HeaterCooler.getCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature).value);
  }

  async handleTargetHeaterHeatingThresholdTemperatureGet(callback) {
    await this.updateAccessoryCharacteristics();
    callback(null, this.HeaterCooler.getCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature).value);
  }

  async handleCurrentTemperatureGet(callback) {
    await this.updateAccessoryCharacteristics();
    callback(null, this.HeaterCooler.getCharacteristic(this.platform.Characteristic.CurrentTemperature).value);
  }

  async handleRotationSpeedGet(callback) {
    await this.updateAccessoryCharacteristics();
    callback(null, this.HeaterCooler.getCharacteristic(this.platform.Characteristic.RotationSpeed).value);
  }

  async handleSwingModeGet(callback) {
    await this.updateAccessoryCharacteristics();
    callback(null, this.HeaterCooler.getCharacteristic(this.platform.Characteristic.SwingMode).value);
  }

  async handleFanActiveGet(callback) {
    await this.updateAccessoryCharacteristics();
    callback(null, this.Fan.getCharacteristic(this.platform.Characteristic.Active).value);
  }

  async handleFanRotationSpeedGet(callback) {
    await this.updateAccessoryCharacteristics();
    callback(null, this.Fan.getCharacteristic(this.platform.Characteristic.RotationSpeed).value);
  }

  async handleFanSwingModeGet(callback) {
    await this.updateAccessoryCharacteristics();
    callback(null, this.Fan.getCharacteristic(this.platform.Characteristic.SwingMode).value);
  }

  async handleDehumidifierSwitchGet(callback) {
    await this.updateAccessoryCharacteristics();
    callback(null, this.Dehumidifier.getCharacteristic(this.platform.Characteristic.On).value);
  }

  async handleHumidityGet(callback) {
    if (!this.Humidity) {
      return;
    }
    await this.updateAccessoryCharacteristics();
    callback(null, this.Humidity.getCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity).value);
  }

  async updateAccessoryCharacteristics() {
    // updateAccessoryCharacteristics

    // update context.device information from Kumo or Directly
    if(!await this.updateDevice()) { 
      return false;
    }
    
    // update characteristics from context.device
    this.updateHeaterCoolerActive();
    this.updateCurrentHeaterCoolerState();
    this.updateTargetHeaterCoolerState();
    this.updateTargetHeaterCoolingThresholdTemperature();
    this.updateTargetHeaterHeatingThresholdTemperature();
    this.updateCurrentTemperature();
    this.updateFanActive();
    this.updateFanRotationSpeed();
    this.updateFanSwingMode();
    this.updateDehumidifierSwitchOn();
    this.updateCurrentRelativeHumidity();

    //this.platform.log.debug('updateAccessoryCharacteristic completed (%s)', this.accessory.context.serial)
    return true;
  }
  
  // As Device updates take some time to update need to check before updating HAP with stale data.
  async updateDevice() {
    // queryDevice and update context.device depending on last contact/update.
    let device: KumoDevice | KumoDeviceDirect;
    if (!this.directAccess){
      // queryDevice via Kumo Cloud
      device = await this.platform.kumo.queryDevice(this.accessory.context.serial);   
      if(!device) {
        this.platform.log.warn('%s (queryDevice): failed.', this.accessory.displayName);
        return false;
      }
      // set last contact with device time and  add LAG to ensure command went through
      const lastcontact = Date.now() - ((device.seconds_since_contact + KUMO_LAG) * 1000);
     
      if(lastcontact < this.lastupdate) {
        // last contact occured before last set operation
        this.platform.log.debug('%s (queryDevice): No recent update from Kumo cloud', this.accessory.displayName);
        return false;
      }
      this.platform.log.debug('%s (queryDevice): success.', this.accessory.displayName);  

    } else {
      // queryDevice via Direct IP connection
      // only update if data is more than one second old - prevents spamming the device
      if ((Date.now() - KUMO_DEVICE_WAIT) < this.lastquery) {
        //this.platform.log.debug('Recent update from device already performed.');
        if(!this.accessory.context.device) {
          this.platform.log.warn('%s (queryDevice_Direct): accessory context not set - bad IP? reverting to cloud control',
            this.accessory.displayName);
          this.directAccess = false;
          return false;
        }
        return true; //ok to use current data in context to update Characteristic values
      }
      this.lastquery = Date.now(); // update time of last query     
     
      device = await this.platform.kumo.queryDevice_Direct(this.accessory.context.serial);
      if(!device) {
        this.platform.log.warn('%s (queryDevice_Direct): failed.', this.accessory.displayName);
        return false;
      }
      this.platform.log.debug('%s (queryDevice_Direct): success.', this.accessory.displayName);

      if (this.Humidity) {
        this.platform.log.debug('querying external sensors on %s', this.accessory.context.serial);
        const sensorData = await this.platform.kumo.queryDeviceSensors_Direct(this.accessory.context.serial);
        if (sensorData) {
          this.accessory.context.sensors = sensorData;
        }
      }
    }

    // update device contect
    this.accessory.context.device = device;          
    return true;
  }

  private updateCurrentRelativeHumidity() {
    if (!this.Humidity || !this.HumidityBattery) {
      return;
    }
    let currentValue: number = <number>this.Humidity.getCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity).value;
    if (this.accessory.context.sensors && this.accessory.context.sensors.length) {
      const ourSensor = this.accessory.context.sensors[0];
      currentValue = ourSensor.humidity;
      this.platform.log.debug('setting humidity to %s', currentValue);

      if (ourSensor.battery) {
        if (ourSensor.battery < 10) {
          this.platform.log.warn('!!!The sensor attached to device %s has a low battery!!!', this.accessory.context.serial);

          this.Humidity.updateCharacteristic(this.platform.Characteristic.StatusLowBattery, this.platform.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW);
          this.HumidityBattery.updateCharacteristic(this.platform.Characteristic.StatusLowBattery, this.platform.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW);
        } else {
          this.Humidity.updateCharacteristic(this.platform.Characteristic.StatusLowBattery, this.platform.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
          this.HumidityBattery.updateCharacteristic(this.platform.Characteristic.StatusLowBattery, this.platform.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
        }

        this.HumidityBattery.updateCharacteristic(this.platform.Characteristic.BatteryLevel, ourSensor.battery);
      }
    }
    this.Humidity.updateCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity, currentValue);
  }

  private updateHeaterCoolerActive() {
    // HeaterCooler Active
    const operation_mode: number = this.accessory.context.device.operation_mode;
    const mode: string = this.accessory.context.device.mode;

    let currentValue:number = <number>this.HeaterCooler.getCharacteristic(this.platform.Characteristic.Active).value;
    if (operation_mode === 16 || mode === 'off') {
      // Unit inactive
      currentValue = 0;
    } else if (operation_mode === 7 || operation_mode === 2 
          || mode === 'vent' || mode === 'dry') {
      // Fan or Dehumidifier - set Active OFF
      currentValue = 0;
    } else if (operation_mode === 8 || mode === 'auto') {
      // Auto Mode
      currentValue = 1;
    } else if (operation_mode === 1 || operation_mode === 33 
          || mode === 'heat' || mode === 'autoHeat') {
      // Heating
      currentValue = 1;
    } else if (operation_mode === 3 || operation_mode === 35 
          || mode === 'cool' || mode === 'autoCool') {
      // Cooling
      currentValue = 1;
    }
    this.HeaterCooler.updateCharacteristic(this.platform.Characteristic.Active, currentValue);    
  }

  private updateCurrentHeaterCoolerState() {
    // CurrentHeaterCoolerState
    const operation_mode: number = this.accessory.context.device.operation_mode;
    const mode: string = this.accessory.context.device.mode;

    let currentValue: number = <number>this.HeaterCooler.getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState).value;
    if (operation_mode === 16 || mode === 'off') {
      currentValue = this.platform.Characteristic.CurrentHeaterCoolerState.INACTIVE;
    } else if (operation_mode === 7 || operation_mode === 2
        || mode === 'vent' || mode === 'dry') {
      currentValue = this.platform.Characteristic.CurrentHeaterCoolerState.IDLE;
    } else if (operation_mode === 1 || operation_mode === 33 
        || mode === 'heat' || mode === 'autoHeat') {
      currentValue = this.platform.Characteristic.CurrentHeaterCoolerState.HEATING;
    } else if (operation_mode === 3 || operation_mode === 35 
        || mode === 'cool' || mode === 'autoCool') {
      currentValue = this.platform.Characteristic.CurrentHeaterCoolerState.COOLING;
    }
    this.HeaterCooler.updateCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState, currentValue);  
  }

  private updateTargetHeaterCoolerState() {
    // TargetHeaterCoolerState
    const operation_mode: number = this.accessory.context.device.operation_mode;
    const mode: string = this.accessory.context.device.mode;

    let currentValue: number = <number>this.HeaterCooler.getCharacteristic(this.platform.Characteristic.TargetHeaterCoolerState).value;
    if (operation_mode === 8 || mode === 'auto' || mode === 'autoHeat' || mode === 'autoCool') {
      currentValue = this.platform.Characteristic.TargetHeaterCoolerState.AUTO;
    } else if (operation_mode === 1 || mode === 'heat') {
      currentValue = this.platform.Characteristic.TargetHeaterCoolerState.HEAT;
    } else if (operation_mode === 3 || mode === 'cool') {
      currentValue = this.platform.Characteristic.TargetHeaterCoolerState.COOL;
    }
    this.HeaterCooler.updateCharacteristic(this.platform.Characteristic.TargetHeaterCoolerState, currentValue);
  }

  private updateTargetHeaterCoolingThresholdTemperature() {
    // TargetHeaterCoolingThresholdTemperature
    let currentValue: number = <number>this.HeaterCooler.getCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature).value;
    if(this.accessory.context.device.sp_cool === undefined) {
      currentValue = this.accessory.context.device.spCool;
    } else {
      currentValue = this.accessory.context.device.sp_cool;
    }
    this.HeaterCooler.updateCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature, currentValue);
  }
  
  private updateTargetHeaterHeatingThresholdTemperature() {
    // TargetHeaterHeatingThresholdTemperature
    let currentValue: number = <number>this.HeaterCooler.getCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature).value;
    if(this.accessory.context.device.sp_heat === undefined){
      currentValue = this.accessory.context.device.spHeat;
    } else {
      currentValue = this.accessory.context.device.sp_heat;
    }
    this.HeaterCooler.updateCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature, currentValue);
  }
  
  private updateCurrentTemperature() {
    // CurrentTemperature
    let currentValue: number = <number>this.HeaterCooler.getCharacteristic(this.platform.Characteristic.CurrentTemperature).value;
    if(this.accessory.context.device.roomTemp !== undefined) {
      currentValue = this.accessory.context.device.roomTemp;
    } else if(this.accessory.context.device.room_temp !== undefined) {
      currentValue = this.accessory.context.device.room_temp;
    } else {
      // no valid target temperature reported from device
      this.platform.log.warn('%s: Unable to find current temp', this.accessory.displayName);
      this.platform.log.warn(this.accessory.context.device);
    }
    this.HeaterCooler.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, currentValue);

    // add history service entry
    this.historyService.addEntry({
      time: Date.now(),
      temp: currentValue,
    });
  }
  
  private updateFanActive() {
    // FanActive
    const power: number = this.accessory.context.device.power;
    const fan_speed: number = this.accessory.context.device.fan_speed;  
    const mode: string = this.accessory.context.device.mode;
    const fanAuto: boolean = this.accessory.context.device.fanSpeed === 'auto';

    let currentValue: number;
    if(
      (fan_speed > 0 && power === 1 && !this.directAccess) ||
      (!fanAuto && mode !== 'off' && this.directAccess)
    ) {
      currentValue = 1;
    } else {
      currentValue = 0;
    }
    this.Fan.updateCharacteristic(this.platform.Characteristic.Active, currentValue);
  }
  
  private updateFanRotationSpeed() {
    // FanRotationSpeed
    const fan_speed: number = this.accessory.context.device.fan_speed; 
    const fanSpeed: string = this.accessory.context.device.fanSpeed;

    const currentFanState = fanStateMap[this.directAccess ? fanSpeed : fan_speed] ?? fanStateMap[0];

    this.HeaterCooler.updateCharacteristic(this.platform.Characteristic.RotationSpeed, currentFanState.percent);
    this.Fan.updateCharacteristic(this.platform.Characteristic.RotationSpeed, currentFanState.percent);
  }
  
  private updateFanSwingMode() {  
    // FanSwingMode
    const air_direction: number = this.accessory.context.device.air_direction;
    const vaneDir: string = this.accessory.context.device.vaneDir;  

    let currentValue: number = <number>this.HeaterCooler.getCharacteristic(this.platform.Characteristic.SwingMode).value;
    // retrieve air_direction
    if(air_direction === 7 || vaneDir === 'swing') {
      currentValue = this.platform.Characteristic.SwingMode.SWING_ENABLED;
    } else {
      currentValue = this.platform.Characteristic.SwingMode.SWING_DISABLED;
    }
    this.HeaterCooler.updateCharacteristic(this.platform.Characteristic.SwingMode, currentValue);
    this.Fan.updateCharacteristic(this.platform.Characteristic.SwingMode, currentValue);
  }
  
  private updateDehumidifierSwitchOn() {
    // Dehumidifier Switch
    const operation_mode: number = this.accessory.context.device.operation_mode;
    const mode: string = this.accessory.context.device.mode;

    let currentValue: boolean = <boolean>this.Dehumidifier.getCharacteristic(this.platform.Characteristic.On).value;
    if (operation_mode === 2 || mode === 'dry') {
      currentValue = true;
    } else {
      currentValue = false;
    }
    this.Dehumidifier.updateCharacteristic(this.platform.Characteristic.On, currentValue);
  }

  // handlers SET

  // Handle requests to set the "Active" characteristic
  async handleActiveSet(value, callback) {
    // check power status
    if (!(await this.updateDevice())) {
      callback(null);
      return;
    }

    const value_old: number = <number>this.HeaterCooler.getCharacteristic(this.platform.Characteristic.Active).value;

    let command: Record<string, unknown> | undefined;
    let commandDirect: Record<string, unknown> | undefined;
    if(value === 0 && value_old === 1) {
      const fanSpeed: number = <number>this.HeaterCooler.getCharacteristic(
        this.platform.Characteristic.RotationSpeed).value;
      if (fanSpeed) {
        // The fan is currently at a set speed (not auto). Set mode to vent.
        command = {'operationMode':7};
        commandDirect = {'mode':'vent'};
      } else {
        // The fan state is currently auto. Power off.
        command = {'power':0, 'operationMode':16};
        commandDirect = {'mode':'off'};
      }
      this.HeaterCooler.updateCharacteristic(this.platform.Characteristic.Active, 0);
    } else if(value === 1 && value_old === 0) {
      // use existing TargetHeaterCoolerState
      const value: number = <number>this.HeaterCooler.getCharacteristic(
        this.platform.Characteristic.TargetHeaterCoolerState).value;
      if(value === this.platform.Characteristic.TargetHeaterCoolerState.AUTO) {
        command = {'power':1, 'operationMode':8};
        commandDirect = {'mode': 'auto'};
      } else if(value === this.platform.Characteristic.TargetHeaterCoolerState.HEAT) {
        command = {'power':1, 'operationMode':1};
        commandDirect = {'mode': 'heat'};
      } else if(value === this.platform.Characteristic.TargetHeaterCoolerState.COOL) {
        command = {'power':1, 'operationMode':3};
        commandDirect = {'mode': 'cool'};
      } else {
        // turn ON auto mode if not already set.
        command = {'power':1, 'operationMode':8};
        commandDirect = {'mode': 'auto'};
      }
      this.HeaterCooler.updateCharacteristic(this.platform.Characteristic.Active, 1);
    }

    if(command !== undefined || commandDirect !== undefined) {
      if(command !== undefined && !this.directAccess) {
        await this.platform.kumo.execute(this.accessory.context.serial, command);
      } else if (commandDirect !== undefined && this.directAccess) {
        await this.platform.kumo.execute_Direct(this.accessory.context.serial, commandDirect);
      }
      this.lastupdate = Date.now();
      this.platform.log.info('%s (Heater/Cooler): set Active from %s to %s', this.accessory.displayName, value_old, value);  
      // switch off dehumidifier accessory
      this.Dehumidifier.updateCharacteristic(this.platform.Characteristic.On, 0);
    }
    callback(null);
  }

  // Handle requests to set the "Target Heater Cooler State" characteristic
  handleTargetHeaterCoolerStateSet(value, callback) {
    const value_old: number = <number>this.HeaterCooler.getCharacteristic(
      this.platform.Characteristic.TargetHeaterCoolerState).value;

    let command: Record<string, unknown> | undefined;
    let commandDirect: Record<string, unknown> | undefined;
    if(value !== value_old){
      if(value === this.platform.Characteristic.TargetHeaterCoolerState.AUTO) {
        command = {'power':1, 'operationMode':8};
        commandDirect = {'mode':'auto'};
      } else if(value === this.platform.Characteristic.TargetHeaterCoolerState.HEAT) {
        command = {'power':1, 'operationMode':1};
        commandDirect = {'mode':'heat'};
      } else if(value === this.platform.Characteristic.TargetHeaterCoolerState.COOL) {
        command = {'power':1, 'operationMode':3};
        commandDirect = {'mode':'cool'};
      } 
    }

    if(command !== undefined || commandDirect !== undefined) {
      if(command !== undefined && !this.directAccess) {
        this.platform.kumo.execute(this.accessory.context.serial, command);
      } else if (commandDirect !== undefined && this.directAccess) {
        this.platform.kumo.execute_Direct(this.accessory.context.serial, commandDirect);
      }
      this.lastupdate = Date.now();
      this.platform.log.info('%s (Heater/Cooler): set TargetState from %s to %s.', this.accessory.displayName, value_old, value);  
    }
    callback(null);
  }  

  handleTargetHeaterCoolingThresholdTemperatureSet(value, callback) {
    const minCoolSetpoint: number = this.accessory.context.zoneTable.minCoolSetpoint;

    if (this.HeaterCooler.getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState).value ===
        this.platform.Characteristic.CurrentHeaterCoolerState.HEATING) {
       this.platform.log.info('%s (Heater/Cooler): in heat mode but cooling threshold change requested; overriding', this.accessory.displayName);
       this.handleTargetHeaterHeatingThresholdTemperatureSet(value, callback);
       return;
    }
    
    if(value<minCoolSetpoint) {
      value = minCoolSetpoint;
    } else {
      this.platform.log.debug('spCool C:', value);
      value = this.roundHalf(value);
      this.platform.log.debug('rounded to:', value);
    }
    this.HeaterCooler.updateCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature, value);

    const command: Record<string, unknown> = {'spCool':value};
    const commandDirect: Record<string, unknown> = {'spCool':value};
    
    if(!this.directAccess) {
      this.platform.kumo.execute(this.accessory.context.serial, command);
    } else {
      this.platform.kumo.execute_Direct(this.accessory.context.serial, commandDirect);
    }
    this.lastupdate = Date.now();
    this.platform.log.info('%s (Heater/Cooler): set CoolingThresholdTemperature to %s', this.accessory.displayName, value);
    callback(null);
  }  

  handleTargetHeaterHeatingThresholdTemperatureSet(value, callback) {
    const maxHeatSetpoint: number = this.accessory.context.zoneTable.maxHeatSetpoint;

    if (this.HeaterCooler.getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState).value ===
        this.platform.Characteristic.CurrentHeaterCoolerState.COOLING) {
       this.platform.log.info('%s (Heater/Cooler): in cool mode but heating threshold change requested; overriding', this.accessory.displayName);
       this.handleTargetHeaterCoolingThresholdTemperatureSet(value, callback);
       return;
    }

    if(value>maxHeatSetpoint) {
      value = maxHeatSetpoint;
    } else {
      this.platform.log.debug('spHeat C:', value);
      value = this.roundHalf(value);
      this.platform.log.debug('rounded to:', value);
    }
    this.HeaterCooler.updateCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature, value);

    const command: Record<string, unknown> = {'spHeat':value};
    const commandDirect: Record<string, unknown> = {'spHeat':value};

    if(!this.directAccess) {
      this.platform.kumo.execute(this.accessory.context.serial, command);
    } else {
      this.platform.kumo.execute_Direct(this.accessory.context.serial, commandDirect);
    }
    this.lastupdate = Date.now();
    this.platform.log.info('%s (Heater/Cooler): set HeatingThresholdTemperature to %s.', this.accessory.displayName, value);
    callback(null);
  }  

  async handleFanActiveSet(value, callback) {
    // check power status
    if (!(await this.updateDevice())) {
      callback(null);
      return;
    }

    // logic to set active on fan 
    let command: Record<string, unknown> | undefined;
    let commandDirect: Record<string, unknown> | undefined;

    let newFanState : FanState | null = null;
    if(value === 0) {
      newFanState = fanStateMap[0];
      if (
        (this.accessory.context.device.power === 1 && this.accessory.context.device.operation_mode === 7) ||
        this.accessory.context.device.mode === 'vent'
      ) {
        // Current mode is vent (fan), so set mode to off.
        command = {'power':0, 'operationMode':16};
        commandDirect = {'mode':'off'};
        newFanState = fanStateMap[0];
      } else if (
        (this.accessory.context.device.power === 1 && this.accessory.context.device.operation_mode !== 7) ||
        (this.accessory.context.device.mode !== 'off' && this.accessory.context.device.mode !== 'vent')
      ) {
        // Some other mode is active, so just set fan to auto.
        command = {'fanSpeed':0};
        commandDirect = {'fanSpeed':'auto'};
      }
    } else if(value === 1) {    
      // If the fan is currently at a set speed, possibly because the speed was *just* updated by
      // handleFanRotationSpeedSet(), then turn on to that speed. Otherwise turn on to max speed.
      const currentFanSpeed = <number>this.HeaterCooler.getCharacteristic(
        this.platform.Characteristic.RotationSpeed).value;
      newFanState = currentFanSpeed ? fanStateMap[currentFanSpeed] : fanStateMap[100];

      if(
        (this.accessory.context.device.power === 1 && this.accessory.context.device.fan_speed === 0) ||
          (this.accessory.context.device.mode !== 'off' && this.accessory.context.device.fanSpeed === 'auto')
      ) {
        // if power ON and fan speed = AUTO, set fan speed to maximum
        command = {'fanSpeed':newFanState.value}; 
        commandDirect = {'fanSpeed':newFanState.name}; 
      } else if (this.accessory.context.device.power === 0 || this.accessory.context.device.mode === 'off' ) {
        // if power OFF, set power to on, operationMode to 7 (vent) and fan speed to maximum
        command = {'power':1, 'operationMode':7, 'fanSpeed':newFanState.value};
        commandDirect = {'mode':'vent', 'fanSpeed':newFanState.name};
      }
    }

    // only issue a command if not null
    if(newFanState) {
      this.HeaterCooler.updateCharacteristic(this.platform.Characteristic.RotationSpeed, newFanState.percent);
      this.Fan.updateCharacteristic(this.platform.Characteristic.RotationSpeed, newFanState.percent);
      this.Fan.updateCharacteristic(this.platform.Characteristic.Active, newFanState.percent ? 1 : 0);

      if(command !== undefined && !this.directAccess) {
        this.platform.kumo.execute(this.accessory.context.serial, command);
      } else if (commandDirect !== undefined && this.directAccess) {
        this.platform.kumo.execute_Direct(this.accessory.context.serial, commandDirect);
      }
      this.lastupdate = Date.now();
      this.platform.log.info('%s (Fan): set Active to %s.', this.accessory.displayName, value);
    }
    callback(null);
  }

  async handleFanRotationSpeedSet(value, callback) {
    const value_old: number = <number>this.HeaterCooler.getCharacteristic(this.platform.Characteristic.RotationSpeed).value;

    // Ensure the speed value (percent) is a multiple of the step.
    value = Math.floor(value / fanPercentStep) * fanPercentStep;

    // only send command if value has changed
    if(value !== value_old) {
      const newFanState = fanStateMap[value] ?? fanStateMap[0];

      // send comand to update fanSpeed    
      const command: Record<string, number> = {'fanSpeed':newFanState.value};
      const commandDirect: Record<string, string> = {'fanSpeed':newFanState.name};

      // Update characteristics before sending the command, to win the race with handleFanActiveSet().
      this.HeaterCooler.updateCharacteristic(this.platform.Characteristic.RotationSpeed, value);
      this.Fan.updateCharacteristic(this.platform.Characteristic.RotationSpeed, value);
      this.platform.log.info('%s (Fan): set RotationSpeed from %s to %s.', this.accessory.displayName, value_old, value);

      if(!this.directAccess) {
        await this.platform.kumo.execute(this.accessory.context.serial, command);
      } else {
        await this.platform.kumo.execute_Direct(this.accessory.context.serial, commandDirect);
      }
    }
    this.lastupdate = Date.now();
    callback(null);
  }


  handleFanSwingModeSet (value, callback) {
    let command: Record<string, unknown> | undefined;
    let commandDirect: Record<string, unknown> | undefined;
    if(value === this.platform.Characteristic.SwingMode.SWING_ENABLED){
      command = {'airDirection':7};
      commandDirect = {'vaneDir':'swing'};
    } else {
      command = {'airDirection':0};
      commandDirect = {'vaneDir':'auto'};
    }

    if(!this.directAccess) {
      this.platform.kumo.execute(this.accessory.context.serial, command);
    } else {
      this.platform.kumo.execute_Direct(this.accessory.context.serial, commandDirect);
    }
    this.lastupdate = Date.now();
    this.platform.log.info('%s (Fan): set Swing to %s.', this.accessory.displayName, value);  
    callback(null);
  }

  handleDehumidifierSwitchSet(value, callback) {
    let command: Record<string, unknown> | undefined;
    let commandDirect: Record<string, unknown> | undefined;

    if(!value) {
      command = {'power':0, 'operationMode':16};
      commandDirect = {'mode':'off'};
      // turn off Dehumidifier - set HeaterCooler to OFF, fan to OFF
      this.HeaterCooler.updateCharacteristic(this.platform.Characteristic.Active, 0);
      this.Fan.updateCharacteristic(this.platform.Characteristic.Active, 0);
      
    } else {
      // turn on Dehumidifer - set HeaterCooler to OFF, fan to AUTO, vane to SWING_DISABLED
      command = {'power':1, 'operationMode':2, 'fanSpeed':0};
      commandDirect = {'mode':'dry', 'fanSpeed':'auto'}; 
      this.HeaterCooler.updateCharacteristic(this.platform.Characteristic.Active, 0);
      this.HeaterCooler.updateCharacteristic(this.platform.Characteristic.RotationSpeed, 0);
      this.Fan.updateCharacteristic(this.platform.Characteristic.RotationSpeed, 0);
    }
  
    if(!this.directAccess) {
      this.platform.kumo.execute(this.accessory.context.serial, command);
    } else {
      this.platform.kumo.execute_Direct(this.accessory.context.serial, commandDirect);
    }
    this.lastupdate = Date.now();
    this.platform.log.info('%s (DehumidiferSwitch): set Active to %s.', this.accessory.displayName, value);  
    callback(null);
  }

  private roundHalf(num: number) {
    return Math.round(num*2)/2;
  }
}



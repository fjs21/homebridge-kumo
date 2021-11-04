<p align="center">
<img src="https://github.com/homebridge/branding/raw/master/logos/homebridge-wordmark-logo-vertical.png" width="150"><br/>
<img src="https://assets.ifttt.com/images/channels/2147036620/icons/large.png" width="150">
</p>


# Homebridge Kumo
[![Downloads](https://badgen.net/npm/dt/homebridge-kumo)](https://www.npmjs.com/package/homebridge-kumo)
[![Version](https://badgen.net/npm/v/homebridge-kumo)](https://www.npmjs.com/package/homebridge-kumo)
[![verified-by-homebridge](https://badgen.net/badge/homebridge/verified/purple)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)

[![GitHub issues](https://img.shields.io/github/issues/fjs21/homebridge-kumo)](https://github.com/fjs21/homebridge-kumo/issues)
[![GitHub pull requests](https://img.shields.io/github/issues-pr/fjs21/homebridge-kumo)](https://github.com/fjs21/homebridge-kumo/pulls)

## Kumo device support for [Homebridge](https://homebridge.io).
`homebridge-kumo` is a [Homebridge](https://homebridge.io) plugin that makes Kumo-enabled devices available to [Apple's](https://www.apple.com) [HomeKit](https://www.apple.com/ios/home) smart home platform. This plugin enables control of Mitsubishi's [kumo cloud](https://www.mitsubishicomfort.com/kumocloud) and currently supports Minisplit units via the offical WiFi accesory.

## Why use this plugin for Kumo cloud support in HomeKit?
In a similar vein to `homebridge-myq2`, this plugin aims to keep user configuration to a minimum. This plugin will dynamically add (but not yet remove) devices found in your Kumo account. This way the only configuration needed is your username and password for the Kumo cloud.

### Features
- ***Easy* configuration - all you need is your username and password to get started.** The defaults work for the vast majority of users.

- **Automatic detection and configuration of multiple Kumo devices.** By default - all of your supported Kumo devices are made available in HomeKit.

### <A NAME="kumo-contribute"></A>How you can contribute and make this plugin even better
As far as I can tell the Kumo API is undocumented and implementing this plugin took many hours of tweaking, reverse engineering, and a lot of trial and error. This work stands on the shoulders of other Kumo (especially [pykumo](https://github.com/dlarrick/pykumo)) and other similar API projects out there.

I would love to support more types of Kumo devices. I have only tested this plugin with my own Mitsubishi split-system heat pump (minisplit) Model MSZ-FH12NA coupled with a PAC-USWHS002-WF-2 WiFi module.  

If you have these devices and would like to contribute, please open an [issue](https://github.com/fjs21/homebridge-kumo/issues), label it as a enhancement, and let's figure out how to make this plugin even better! Bonus points if you like puzzles and lots of debugging output. :smile:

## Installation
If you are new to Homebridge, please first read the [Homebridge](https://homebridge.io) [documentation](https://github.com/homebridge/homebridge/wiki) and installation instructions before proceeding.

If you have installed the [Homebridge Config UI](https://github.com/oznu/homebridge-config-ui-x), you can intall this plugin by going to the `Plugins` tab and searching for `homebridge-kumo` and installing it.

If you prefer to install `homebridge-kumo` from the command line, you can do so by executing:

```sh
sudo npm install -g homebridge-kumo
```

### Changelog
v.1.1.1 included support for multiple "sites" on kumo cloud. All devices are currently incorporated into Homebridge. This could be easily customized in the future if multiple homes were controlled by a single kumo account. 
v.1.1.x includes control via direct IP connection from Homebridge to device. This is much faster than via the kumo cloud API. The kumo cloud is still queried on start up for list of devices and information needed to configure them.

## Plugin Configuration
If you choose to configure this plugin directly instead of using the [Homebridge Configuration web UI](https://github.com/oznu/homebridge-config-ui-x), you'll need to add the platform to your `config.json` in your home directory inside `.homebridge`.

```js
"platforms": [{
    "platform": "Kumo",
    "username": "email@email.com",
    "password": "password",
    "directAccess": false
}]
```

For most people, I recommend using [Homebridge Configuration web UI](https://github.com/oznu/homebridge-config-ui-x) to configure this plugin rather than doing so directly. It's easier to use for most users, especially newer users, and less prone to typos, leading to other problems.

### Troubleshooting

1. Issue #45 (and others). If using directAccess, please ensure that the IP address assigned to your Kumo devices is static. The IP address is retrieved from the Kumo cloud at plugin startup and can become out of sync if the Wifi router reboots and assigns a new IP address. Until the Kumo cloud updates (which is unclear when this happens), the plugin will fail to connect.

2. Issue #42. There have been reports of time out errors occuring when using other plugins specifically homebridge-wemo. If you encounter a time out error, please move homebridge-kumo to a seperate bridge.

3. Issue #3. The temperature calculations used by Kumo and Homekit are not identical. As the temperature used on the backend is entirely in celcius both the Kumo app and Home apps convert these values to farenheit. There are some discrpencies in the calculation which will lead to temeperatures being incorrectly reported at certain values. 

## Credits
This plugin used many cues from [homebridge-myq2](https://github.com/hjdhjd/homebridge-myq2/) for plugin structure and [homebridge-kumo](https://github.com/mikaelnelson/homebridge-kumo) for getting started with the Kumo API. In v.1.1, I have incorporated information from [pykumo](https://github.com/dlarrick/pykumo) and [homebridge-kumo-local](https://github.com/monteroman/homebridge-kumo-local) to allow direct IP and *rapid* control of devices on the network. 

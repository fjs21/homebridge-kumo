<p align="center">
<img src="https://github.com/homebridge/branding/raw/master/logos/homebridge-wordmark-logo-vertical.png" width="150"><br/>
<img src="https://www.mitsubishicomfort.com/sites/default/themes/mitsubishicomfort/_assets/images/logo.png" width="150">
</p>


# Homebridge Kumo
[![Downloads](https://badgen.net/npm/dt/homebridge-kumo)](https://www.npmjs.com/package/homebridge-kumo)
[![Version](https://badgen.net/npm/v/homebridge-kumo)](https://www.npmjs.com/package/homebridge-kumo)

[![GitHub issues](https://img.shields.io/github/issues/fjs21/homebridge-kumo)](https://github.com/fjs21/homebridge-kumo/issues)
[![GitHub pull requests](https://img.shields.io/github/issues-pr/fjs21/homebridge-kumo)](https://github.com/fjs21/homebridge-kumo/pulls)

## Kumo device support for [Homebridge](https://homebridge.io).
`homebridge-kumo` is a [Homebridge](https://homebridge.io) plugin that makes Kumo-enabled devices available to [Apple's](https://www.apple.com) [HomeKit](https://www.apple.com/ios/home) smart home platform. This plugin enables control of Mitsubishi's [kumo cloud](https://www.mitsubishicomfort.com/kumocloud) and currently supports Minisplit units via the offical WiFi accesory.

## Why use this plugin for Kumo cloud support in HomeKit?
In a similar vein to `homebridge-myq2`, this plugin aims to keep user configuration to a minimum. This plugin with dynamically add (but not yet remove) devices found in you Kumo account. This way the only conifiguration needed is your username and password for the Kumo cloud.

### Features
- ***Easy* configuration - all you need is your username and password to get started.** The defaults work for the vast majority of users.

- **Automatic detection and configuration of multiple Kumo devices.** By default - all of your supported Kumo devices are made available in HomeKit.

### <A NAME="kumo-contribute"></A>How you can contribute and make this plugin even better
As far as I can tell the Kumo API is undocumented and implementing this plugin took many hours of reverse engineering, and a lot of trial and error. This work stands on the shoulders of other Kumo and other similar API projects out there.

I would love to support more types of Kumo devices. I have only tested this plugin with my own Mitsubishi split-system heat pump (minisplit) Model MSZ-FH12NA coupled with a PAC-USWHS002-WF-2 WiFi module.  

If you have these devices and would like to contribute, please open an [issue](https://github.com/fjs21/homebridge-kumo/issues), label it as a enhancement, and let's figure out how to make this plugin even better! Bonus points if you like puzzles and lots of debugging output. :smile:

## Installation
If you are new to Homebridge, please first read the [Homebridge](https://homebridge.io) [documentation](https://github.com/homebridge/homebridge/wiki) and installation instructions before proceeding.

If you have installed the [Homebridge Config UI](https://github.com/oznu/homebridge-config-ui-x), you can intall this plugin by going to the `Plugins` tab and searching for `homebridge-myq2` and installing it.

If you prefer to install `homebridge-myq2` from the command line, you can do so by executing:

```sh
sudo npm install -g homebridge-kumo
```

### Changelog
Not yet implemented as this is first public version.

## Plugin Configuration
If you choose to configure this plugin directly instead of using the [Homebridge Configuration web UI](https://github.com/oznu/homebridge-config-ui-x), you'll need to add the platform to your `config.json` in your home directory inside `.homebridge`.

```js
"platforms": [{
    "platform": "Kumo",
    "username": "email@email.com",
    "password": "password"
}]
```

For most people, I recommend using [Homebridge Configuration web UI](https://github.com/oznu/homebridge-config-ui-x) to configure this plugin rather than doing so directly. It's easier to use for most users, especially newer users, and less prone to typos, leading to other problems.

## Credits
This plugin used many cues from [homebridge-myq2](https://github.com/hjdhjd/homebridge-myq2/) for plugin structure and [homebridge-kumo](https://github.com/mikaelnelson/homebridge-kumo) for getting started with the Kumo API.

## Donate to Support homebridge-kumo
This plugin was made with you in mind. If you would like to show your appreciation for its continued development, please consider making [a small donation](https://www.paypal.com/cgi-bin/webscr?cmd=_donations&business=Y7PRYWBYVLMS2&item_name=homebridge-kumo&currency_code=USD&source=url).
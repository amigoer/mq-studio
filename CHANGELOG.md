# Changelog

All notable changes to MQ Studio are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

[简体中文](CHANGELOG.zh-CN.md)

## [Unreleased]

## [0.0.1] - 2026-08-31

Initial release of the rebuilt project.

### Added

- The application was reorganised around a driver port: a broker family is a
  driver behind one interface, and the interface is drawn from what a connected
  endpoint reports it can do.
- Support for RocketMQ 4.x and 5.x.

### Notes

- RocketMQ is the only broker that can be connected. The other protocols appear
  in the interface and are disabled.
- Version numbering starts over here. The 0.1.x builds predate the rebuild and
  have been removed.

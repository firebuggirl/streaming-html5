// Chrome & Firefox
(function(window, document, red5prosdk) {
  'use strict';

  var serverSettings = (function() {
    var settings = sessionStorage.getItem('r5proServerSettings');
    try {
      return JSON.parse(settings);
    }
    catch (e) {
      console.error('Could not read server settings from sessionstorage: ' + e.message);
    }
    return {};
  })();

  var configuration = (function () {
    var conf = sessionStorage.getItem('r5proTestBed');
    try {
      return JSON.parse(conf);
    }
    catch (e) {
      console.error('Could not read testbed configuration from sessionstorage: ' + e.message);
    }
    return {}
  })();

  red5prosdk.setLogLevel(configuration.verboseLogging ? red5prosdk.LOG_LEVELS.TRACE : red5prosdk.LOG_LEVELS.WARN);


  var targetPublisher;
  var audioPublisher;

  var updateStatusFromEvent = window.red5proHandlePublisherEvent; // defined in src/template/partial/status-field-publisher.hbs
  var streamTitle = document.getElementById('stream-title');
  var statisticsField = document.getElementById('statistics-field');
  var captureButton = document.getElementById('capture-button');
  //  var audioButton = document.getElementById('audio-button');

  var bandwidthAudioField = document.getElementById('audio-bitrate-field');
  var bandwidthVideoField = document.getElementById('video-bitrate-field');
  var keyFramerateField = document.getElementById('key-framerate-field');
  var cameraWidthField = document.getElementById('camera-width-field');
  var cameraHeightField = document.getElementById('camera-height-field');
  var framerateField =document.getElementById('framerate-field');

  bandwidthAudioField.value = configuration.bandwidth.audio;
  bandwidthVideoField.value = configuration.bandwidth.video;
  keyFramerateField.value = configuration.keyFramerate || 3000;
  cameraWidthField.value = configuration.mediaConstraints.video !== true ? configuration.mediaConstraints.video.width.max : 640;
  cameraHeightField.value = configuration.mediaConstraints.video !== true ? configuration.mediaConstraints.video.height.max : 480;
  framerateField.value = configuration.mediaConstraints.video !== true ? configuration.mediaConstraints.video.frameRate.max : 24;

  captureButton.addEventListener('click', function() {
    capture(setupPublisher);
  });

  /*
  audioButton.addEventListener('click', function() {
    setupAudio();
  })
  */

  var protocol = serverSettings.protocol;
  var isSecure = protocol == 'https';
  function getSocketLocationFromProtocol () {
    return !isSecure
      ? {protocol: 'ws', port: serverSettings.wsport}
      : {protocol: 'wss', port: serverSettings.wssport};
  }

  function onBitrateUpdate (bitrate, packetsSent) {
    statisticsField.innerText = 'Bitrate: ' + Math.floor(bitrate) + '. Packets Sent: ' + packetsSent + '.';
  }

  function onPublisherEvent (event) {
    console.log('[Red5ProPublisher] ' + event.type + '.');
    updateStatusFromEvent(event);
  }

  function onPublisherAudioEvent (event) {
    console.log('[Red5ProPublisher:AUDIO] ' + event.type + '.');
  }

  function onPublishFail (message) {
    console.error('[Red5ProPublisher] Publish Error :: ' + message);
  }

  function onPublishSuccess (publisher) {
    console.log('[Red5ProPublisher] Publish Complete.');
    try {
      window.trackBitrate(publisher.getPeerConnection(), onBitrateUpdate);
    }
    catch (e) {
      // no tracking for you!
    }
  }
  function onUnpublishFail (message) {
    console.error('[Red5ProPublisher] Unpublish Error :: ' + message);
  }
  function onUnpublishSuccess () {
    console.log('[Red5ProPublisher] Unpublish Complete.');
  }

  function getAuthenticationParams () {
    var auth = configuration.authentication;
    return auth && auth.enabled
      ? {
        connectionParams: {
          username: auth.username,
          password: auth.password
        }
      }
      : {};
  }

  function capture (cb) {
    var vw = parseInt(cameraWidthField.value);
    var vh = parseInt(cameraHeightField.value);
    var fr = parseInt(framerateField.value);
    var config = {
        audio: false,
        video: {
          width: { maxWidth: vw },
          height: { maxHeight: vh },
          frameRate: { maxFrameRate: fr }
        }
    };
    // Edge has getDisplayMedia on navigator and not media devices?
    var p = undefined
    if (navigator.getDisplayMedia) {
      p = navigator.getDisplayMedia(config)
    } else {
      p = navigator.mediaDevices.getDisplayMedia(config)
    }
    p.then(cb).catch(function (error) {
      console.error(error);
    });
  }

  function unpublish (publisher) {
    return new Promise(function (resolve, reject) {
      publisher.unpublish()
        .then(function () {
          onUnpublishSuccess();
          resolve();
        })
        .catch(function (error) {
          var jsonError = typeof error === 'string' ? error : JSON.stringify(error, 2, null);
          onUnpublishFail('Unmount Error ' + jsonError);
          reject(error);
        });
    });
  }

  function setupAudio () {
    var audioConfig = Object.assign({},
      configuration, 
      getAuthenticationParams(),
      {
        mediaElementId: 'red5pro-audio',
        protocol: getSocketLocationFromProtocol().protocol,
        port: getSocketLocationFromProtocol().port,
        streamName: configuration.stream1 + '_audio',
        streamMode: configuration.recordBroadcast ? 'record' : 'live',
        mediaConstraints: {
          audio: true,
          video: false
        }
      },
    {
      bandwidth: {
        audio: parseInt(bandwidthAudioField.value)
      }
    });
    new red5prosdk.RTCPublisher()
      .init(audioConfig)
      .then(function (publisherImpl) {
        audioPublisher = publisherImpl;
        audioPublisher.on('*', onPublisherAudioEvent);
        return audioPublisher.publish();
      })
      .then(function () {
        console.debug('[Red5ProPublisher:AUDIO] :: established.')
      })
      .catch(function (error) {
        var jsonError = typeof error === 'string' ? error : JSON.stringify(error, null, 2);
        console.error('[Red5ProPublisher:AUDIO] :: Error in publishing audio - ' + jsonError);
      });
  }

  function setupPublisher (mediaStream) {

    var config = Object.assign({},
                        configuration,
                        {
                          streamMode: configuration.recordBroadcast ? 'record' : 'live'
                        },
                        getAuthenticationParams());

    var rtcConfig = Object.assign({}, config, {
                        protocol: getSocketLocationFromProtocol().protocol,
                        port: getSocketLocationFromProtocol().port,
                        streamName: config.stream1,
                        bandwidth: {
                          video: parseInt(bandwidthVideoField.value)
                        },
                        keyFramerate: parseInt(keyFramerateField.value)
                      });

    new red5prosdk.RTCPublisher()
      .initWithStream(rtcConfig, mediaStream)
      .then(function (publisherImpl) {
        streamTitle.innerText = configuration.stream1;
        targetPublisher = publisherImpl;
        targetPublisher.on('*', onPublisherEvent);
        return targetPublisher.publish();
      })
      .then(function () {
        onPublishSuccess(targetPublisher);
        setupAudio();
      })
      .catch(function (error) {
        var jsonError = typeof error === 'string' ? error : JSON.stringify(error, null, 2);
        console.error('[Red5ProPublisher] :: Error in publishing - ' + jsonError);
        onPublishFail(jsonError);
      });

  }

  var shuttingDown = false;
  function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    function clearRefs () {
      if (targetPublisher) {
        targetPublisher.off('*', onPublisherEvent);
      }
      if (audioPublisher) {
        audioPublisher.off('*', onPublisherAudioEvent);
      }
      targetPublisher = undefined;
      audioPublisher = undefined;
    }
    unpublish(targetPublisher)
      .then(function () {
        if (audioPublisher) {
          return unpublish(audioPublisher);
        }
        return true;
      })
      .then(clearRefs).catch(clearRefs);
    window.untrackBitrate();
  }
  window.addEventListener('pagehide', shutdown);
  window.addEventListener('beforeunload', shutdown);

})(this, document, window.red5prosdk);


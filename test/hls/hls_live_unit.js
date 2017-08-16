/**
 * @license
 * Copyright 2016 Google Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

describe('HlsParser live', function() {
  /** @const */
  var Util = shaka.test.Util;
  /** @const */
  var ManifestParser = shaka.test.ManifestParser;
  /** @type {!shaka.test.FakeNetworkingEngine} */
  var fakeNetEngine;
  /** @type {!shaka.hls.HlsParser} */
  var parser;
  /** @type {shakaExtern.ManifestParser.PlayerInterface} */
  var playerInterface;
  /** @type {shakaExtern.ManifestConfiguration} */
  var config;
  /** @const */
  var updateTime = 5;
  /** @const */
  var master = [
    '#EXTM3U\n',
    '#EXT-X-STREAM-INF:BANDWIDTH=200,CODECS="avc1",',
    'RESOLUTION=960x540,FRAME-RATE=60\n',
    'test://video\n'
  ].join('');


  beforeEach(function() {
    var retry = shaka.net.NetworkingEngine.defaultRetryParameters();
    fakeNetEngine = new shaka.test.FakeNetworkingEngine();
    config = {
      retryParameters: retry,
      dash: {
        customScheme: function(node) { return null; },
        clockSyncUri: '',
        ignoreDrmInfo: false,
        xlinkFailGracefully: false
      },
      hls: {
        defaultTimeOffset: 0
      }
    };
    playerInterface = {
      filterNewPeriod: function() {},
      filterAllPeriods: function() {},
      networkingEngine: fakeNetEngine,
      onError: fail,
      onEvent: fail,
      onTimelineRegionAdded: fail
    };
    parser = new shaka.hls.HlsParser();
    parser.configure(config);
  });

  afterEach(function() {
    // HLS parser stop is synchronous.
    parser.stop();
  });

  /**
   * Simulate time to trigger a manifest update.
   */
  function delayForUpdatePeriod() {
    // Tick the virtual clock to trigger an update and resolve all Promises.
    Util.fakeEventLoop(updateTime);
  }

  function testUpdate(done, master, initialMedia, initialReferences,
                      updatedMedia, updatedReferences) {
    fakeNetEngine.setResponseMapAsText({
      'test://master': master,
      'test://video': initialMedia,
      'test://video2': initialMedia,
      'test://audio': initialMedia
    });
    parser.start('test://master', playerInterface)
      .then(function(manifest) {
          var variants = manifest.periods[0].variants;
          for (var i = 0; i < variants.length; i++) {
            var video = variants[i].video;
            var audio = variants[i].audio;
            ManifestParser.verifySegmentIndex(video, initialReferences);
            if (audio)
              ManifestParser.verifySegmentIndex(audio, initialReferences);
          }

          fakeNetEngine.setResponseMapAsText({
            'test://master': master,
            'test://video': updatedMedia,
            'test://video2': updatedMedia,
            'test://audio': updatedMedia
          });

          delayForUpdatePeriod();
          for (var i = 0; i < variants.length; i++) {
            var video = variants[i].video;
            var audio = variants[i].audio;
            ManifestParser.verifySegmentIndex(video, updatedReferences);
            if (audio)
              ManifestParser.verifySegmentIndex(audio, updatedReferences);
          }
        }).catch(fail).then(done);
    shaka.polyfill.Promise.flush();
  }


  describe('playlist type EVENT', function() {
    var media = [
      '#EXTM3U\n',
      '#EXT-X-PLAYLIST-TYPE:EVENT\n',
      '#EXT-X-TARGETDURATION:5\n',
      '#EXT-X-MAP:URI="test://main.mp4",BYTERANGE="616@0"\n',
      '#EXTINF:2,\n',
      'test://main.mp4\n'
    ].join('');

    var mediaWithAdditionalSegment = [
      '#EXTM3U\n',
      '#EXT-X-TARGETDURATION:5\n',
      '#EXT-X-MAP:URI="test://main.mp4",BYTERANGE="616@0"\n',
      '#EXTINF:2,\n',
      'test://main.mp4\n',
      '#EXTINF:2,\n',
      'test://main2.mp4\n'
    ].join('');

    it('treats already ended presentation like VOD', function(done) {
      fakeNetEngine.setResponseMapAsText({
        'test://master': master,
        'test://video': media + '#EXT-X-ENDLIST'
      });

      parser.start('test://master', playerInterface)
        .then(function(manifest) {
            expect(manifest.presentationTimeline.isLive()).toBe(false);
            expect(manifest.presentationTimeline.isInProgress()).toBe(false);
          })
        .catch(fail)
        .then(done);
    });

    describe('update', function() {
      beforeAll(function() {
        jasmine.clock().install();
        // This polyfill is required for fakeEventLoop.
        shaka.polyfill.Promise.install(/* force */ true);
      });

      afterAll(function() {
        jasmine.clock().uninstall();
        shaka.polyfill.Promise.uninstall();
      });

      it('adds new segments when they appear', function(done) {
        var ref1 = ManifestParser.makeReference('test://main.mp4',
                                                0, 0, 2);
        var ref2 = ManifestParser.makeReference('test://main2.mp4',
                                                1, 2, 4);

        testUpdate(done, master, media, [ref1],
                   mediaWithAdditionalSegment, [ref1, ref2]);
      });

      it('updates all variants', function(done) {
        var secondVariant = [
          '#EXT-X-STREAM-INF:BANDWIDTH=300,CODECS="avc1",',
          'RESOLUTION=1200x940,FRAME-RATE=60\n',
          'test://video2'
        ].join('');

        var masterWithTwoVariants = master + secondVariant;
        var ref1 = ManifestParser.makeReference('test://main.mp4',
                                                0, 0, 2);
        var ref2 = ManifestParser.makeReference('test://main2.mp4',
                                                1, 2, 4);

        testUpdate(done, masterWithTwoVariants, media, [ref1],
                   mediaWithAdditionalSegment, [ref1, ref2]);
      });

      it('updates all streams', function(done) {
        var audio = [
          '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud1",LANGUAGE="eng",',
          'URI="test://audio"\n'
        ].join('');

        var masterWithAudio = master + audio;
        var ref1 = ManifestParser.makeReference('test://main.mp4',
                                                0, 0, 2);
        var ref2 = ManifestParser.makeReference('test://main2.mp4',
                                                1, 2, 4);

        testUpdate(done, masterWithAudio, media, [ref1],
                   mediaWithAdditionalSegment, [ref1, ref2]);
      });

      it('handles multiple updates', function(done) {
        var newSegment1 = [
          '#EXTINF:2,\n',
          'test://main2.mp4\n'
        ].join('');

        var newSegment2 = [
          '#EXTINF:2,\n',
          'test://main3.mp4\n'
        ].join('');

        var updatedMedia1 = media + newSegment1;
        var updatedMedia2 = updatedMedia1 + newSegment2;
        var ref1 = ManifestParser.makeReference('test://main.mp4',
                                                0, 0, 2);
        var ref2 = ManifestParser.makeReference('test://main2.mp4',
                                                1, 2, 4);
        var ref3 = ManifestParser.makeReference('test://main3.mp4',
                                                2, 4, 6);

        fakeNetEngine.setResponseMapAsText({
          'test://master': master,
          'test://video': media
        });
        parser.start('test://master', playerInterface)
          .then(function(manifest) {
              var video = manifest.periods[0].variants[0].video;
              ManifestParser.verifySegmentIndex(video, [ref1]);

              fakeNetEngine.setResponseMapAsText({
                'test://master': master,
                'test://video': updatedMedia1
              });

              delayForUpdatePeriod();
              ManifestParser.verifySegmentIndex(video, [ref1, ref2]);

              fakeNetEngine.setResponseMapAsText({
                'test://master': master,
                'test://video': updatedMedia2
              });

              delayForUpdatePeriod();
              ManifestParser.verifySegmentIndex(video, [ref1, ref2, ref3]);
            }).catch(fail).then(done);
        shaka.polyfill.Promise.flush();
      });

      it('converts presentation to VOD when it is finished', function(done) {
        fakeNetEngine.setResponseMapAsText({
          'test://master': master,
          'test://video': media
        });

        parser.start('test://master', playerInterface)
        .then(function(manifest) {
              expect(manifest.presentationTimeline.isLive()).toBe(true);
              fakeNetEngine.setResponseMapAsText({
                'test://master': master,
                'test://video': mediaWithAdditionalSegment + '#EXT-X-ENDLIST\n'
              });

              delayForUpdatePeriod();
              expect(manifest.presentationTimeline.isLive()).toBe(false);
            }).catch(fail).then(done);
        shaka.polyfill.Promise.flush();
      });
    });
  });

  describe('playlist type LIVE', function() {
    var media = [
      '#EXTM3U\n',
      '#EXT-X-TARGETDURATION:5\n',
      '#EXT-X-MAP:URI="test://main.mp4",BYTERANGE="616@0"\n',
      '#EXTINF:2,\n',
      'test://main.mp4\n'
    ].join('');

    var mediaWithAdditionalSegment = [
      '#EXTM3U\n',
      '#EXT-X-TARGETDURATION:5\n',
      '#EXT-X-MAP:URI="test://main.mp4",BYTERANGE="616@0"\n',
      '#EXTINF:2,\n',
      'test://main.mp4\n',
      '#EXTINF:2,\n',
      'test://main2.mp4\n'
    ].join('');

    var mediaWithRemovedSegment = [
      '#EXTM3U\n',
      '#EXT-X-TARGETDURATION:5\n',
      '#EXT-X-MAP:URI="test://main.mp4",BYTERANGE="616@0"\n',
      '#EXT-X-MEDIA-SEQUENCE:1\n',
      '#EXTINF:2,\n',
      'test://main2.mp4\n'
    ].join('');

    describe('update', function() {
      beforeAll(function() {
        jasmine.clock().install();
        // This polyfill is required for fakeEventLoop.
        shaka.polyfill.Promise.install(/* force */ true);
      });

      afterAll(function() {
        jasmine.clock().uninstall();
        shaka.polyfill.Promise.uninstall();
      });

      it('adds new segments when they appear', function(done) {
        var ref1 = ManifestParser.makeReference('test://main.mp4',
                                                0, 0, 2);
        var ref2 = ManifestParser.makeReference('test://main2.mp4',
                                                1, 2, 4);

        testUpdate(done, master, media, [ref1],
                   mediaWithAdditionalSegment, [ref1, ref2]);
      });

      it('evicts removed segments', function(done) {
        var newSegment = [
          '#EXTINF:2,\n',
          'test://main2.mp4\n'
        ].join('');

        var mediaWithTwoSegments = media + newSegment;

        var ref1 = ManifestParser.makeReference('test://main.mp4',
                                                0, 0, 2);
        var ref2 = ManifestParser.makeReference('test://main2.mp4',
                                                1, 2, 4);

        testUpdate(done, master, mediaWithTwoSegments, [ref1, ref2],
                   mediaWithRemovedSegment, [ref2]);
      });
    });

    describe('getStartTime_', function() {
      it('parses start time from mp4 segment', function(done) {
        var headers = {'content-type': 'video/mp4'};
        fakeNetEngine.setHeadersMap({
          'test://main2.mp4': headers
        });

        var segmentData = new Uint8Array([
          0x00, 0x00, 0x00, 0x24, // size (36)
          0x6D, 0x6F, 0x6F, 0x66, // type (moof)
          0x00, 0x00, 0x00, 0x1C, // traf size (28)
          0x74, 0x72, 0x61, 0x66, // type (traf)
          0x00, 0x00, 0x00, 0x14, // tfdt size (20)
          0x74, 0x66, 0x64, 0x74, // type (tfdt)
          0x01, 0x00, 0x00, 0x00, // version and flags
          0x00, 0x00, 0x00, 0x00, // baseMediaDecodeTime first 4 bytes
          0x00, 0x02, 0xBF, 0x20  // baseMediaDecodeTime last 4 bytes (180000)
        ]).buffer;
        // 180000 divided by TS timescale (90000) = segment starts at 2s.

        var masterData = shaka.util.StringUtils.toUTF8(master);
        var mediaData = shaka.util.StringUtils.toUTF8(mediaWithRemovedSegment);

        fakeNetEngine.setResponseMap({
          'test://master': masterData,
          'test://video': mediaData,
          'test://main2.mp4': segmentData
        });

        var ref = ManifestParser.makeReference('test://main2.mp4', 1, 2, 4);

        parser.start('test://master', playerInterface)
          .then(function(manifest) {
              var video = manifest.periods[0].variants[0].video;
              ManifestParser.verifySegmentIndex(video, [ref]);
            }).catch(fail).then(done);
      });

      it('cannot parse timestamps from non-mp4 content', function(done) {
        // TODO: remove the headers when MIME deduction happens before start
        // time parsing
        var headers = {'content-type': 'video/mp2t'};
        fakeNetEngine.setHeadersMap({
          'test://main2.ts': headers
        });

        var masterData = shaka.util.StringUtils.toUTF8(master);
        var tsMediaPlaylist = mediaWithRemovedSegment.replace(/\.mp4/g, '.ts');
        var mediaData = shaka.util.StringUtils.toUTF8(tsMediaPlaylist);

        fakeNetEngine.setResponseMap({
          'test://master': masterData,
          'test://video': mediaData,
          'test://main2.ts': new ArrayBuffer(10)
        });

        var error = new shaka.util.Error(
            shaka.util.Error.Severity.CRITICAL,
            shaka.util.Error.Category.MANIFEST,
            shaka.util.Error.Code.HLS_COULD_NOT_PARSE_SEGMENT_START_TIME);

        parser.start('test://master', playerInterface)
            .then(fail)
            .catch(function(e) {
              shaka.test.Util.expectToEqualError(e, error);
            })
          .then(done);
      });
    });
  });
});

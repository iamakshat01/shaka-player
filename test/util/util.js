/**
 * @license
 * Copyright 2015 Google Inc.
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

goog.provide('shaka.test.Util');


/**
 * Processes some number of "instantaneous" operations.
 *
 * Instantaneous operations include Promise resolution (e.g.,
 * Promise.resolve()) and 0 second timeouts. This recursively processes
 * these operations, so if for example, one wrote
 *
 * Promise.resolve().then(function() {
 *   var callback = function() {
 *     Promise.resolve().then(function() {
 *       console.log('Hello world!');
 *     });
 *   }
 *   window.setTimeout(callback, 0);
 * });
 *
 * var p = processInstantaneousOperations(10);
 *
 * After |p| resolves, "Hello world!" will be written to the console.
 *
 * The parameter |n| controls the number of rounds to perform. This is
 * necessary since we cannot determine when there are no timeouts remaining
 * at the current time; to determine this we would require access to hidden
 * variables in Jasmine's Clock implementation.
 *
 * @param {number} n The number of rounds to perform.
 * @param {function(function(), number)=} opt_setTimeout
 * @return {!Promise}
 * TODO: Cleanup with patch to jasmine-core.
 */
shaka.test.Util.processInstantaneousOperations = function(n, opt_setTimeout) {
  if (n <= 0) return Promise.resolve();
  return shaka.test.Util.delay(0.001, opt_setTimeout).then(function() {
    jasmine.clock().tick(0);
    return shaka.test.Util.processInstantaneousOperations(--n, opt_setTimeout);
  });
};


/**
 * Fakes an event loop. Each tick processes some number of instantaneous
 * operations and advances the simulated clock forward by 1 second. Calls
 * opt_onTick just before each tick if it's specified.
 *
 * @param {number} duration The number of seconds of simulated time.
 * @param {function(function(), number)=} opt_setTimeout
 * @param {function(number)=} opt_onTick
 * @return {!Promise} A promise which resolves after |duration| seconds of
 *     simulated time.
 */
shaka.test.Util.fakeEventLoop = function(duration, opt_setTimeout, opt_onTick) {
  var async = Promise.resolve();
  for (var time = 0; time < duration; ++time) {
    async = async.then(function() {
      // We shouldn't need more than 5 rounds.
      return shaka.test.Util.processInstantaneousOperations(5, opt_setTimeout);
    }).then(function(currentTime) {
      if (opt_onTick)
        opt_onTick(currentTime);
      jasmine.clock().tick(1000);
      return Promise.resolve();
    }.bind(null, time));
  }
  return async;
};


/**
 * Capture a Promise's status and attach it to the Promise.
 * @param {!Promise} promise
 */
shaka.test.Util.capturePromiseStatus = function(promise) {
  promise.status = 'pending';
  promise.then(function() {
    promise.status = 'resolved';
  }, function() {
    promise.status = 'rejected';
  });
};


/**
 * Returns a Promise which is resolved after the given delay.
 *
 * @param {number} seconds The delay in seconds.
 * @param {function(function(), number)=} opt_setTimeout
 * @return {!Promise}
 */
shaka.test.Util.delay = function(seconds, opt_setTimeout) {
  return new Promise(function(resolve, reject) {
    var timeout = opt_setTimeout || setTimeout;
    timeout(resolve, seconds * 1000.0);
  });
};


/**
 * Replace shaka.asserts and console.assert with a version which hooks into
 * jasmine.  This converts all failed assertions into failed tests.
 */
var assertsToFailures = {
  uninstall: function() {
    shaka.asserts = assertsToFailures.originalShakaAsserts_;
    console.assert = assertsToFailures.originalConsoleAssert_;
  },

  install: function() {
    assertsToFailures.originalShakaAsserts_ = shaka.asserts;
    assertsToFailures.originalConsoleAssert_ = console.assert;

    var realAssert = console.assert.bind(console);

    var jasmineAssert = function(condition, opt_message) {
      realAssert(condition, opt_message);
      if (!condition) {
        var message = opt_message || 'Assertion failed.';
        console.error(message);
        try {
          throw new Error(message);
        } catch (exception) {
          fail(message);
        }
      }
    };

    shaka.asserts = {
      assert: function(condition, opt_message) {
        jasmineAssert(condition, opt_message);
      },
      notImplemented: function() {
        jasmineAssert(false, 'Not implemented.');
      },
      unreachable: function() {
        jasmineAssert(false, 'Unreachable reached.');
      }
    };

    console.assert = jasmineAssert;
  }
};


// Make sure assertions are converted into failures for all tests.
beforeAll(assertsToFailures.install);
afterAll(assertsToFailures.uninstall);

// The library cannot function without certain browser features, and therefore
// neither can many of our tests.  If needed, install the Promise and
// CustomEvent polyfills.  In particular, this is needed on IE11.
beforeAll(function() {
  shaka.log.MAX_LOG_LEVEL = shaka.log.Level.ERROR;
  shaka.log.setLevel(shaka.log.MAX_LOG_LEVEL);

  shaka.polyfill.Promise.install();
  shaka.polyfill.CustomEvent.install();
});

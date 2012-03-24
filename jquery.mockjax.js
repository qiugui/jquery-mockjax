/*!
 * MockJax - jQuery Plugin to Mock Ajax requests
 *
 * Version:  1.5.0pre
 * Released:
 * Home:   http://github.com/appendto/jquery-mockjax
 * Author:   Jonathan Sharp (http://jdsharp.com)
 * License:  MIT,GPL
 *
 * Copyright (c) 2011 appendTo LLC.
 * Dual licensed under the MIT or GPL licenses.
 * http://appendto.com/open-source-licenses
 */
(function($) {
	var _ajax = $.ajax,
		mockHandlers = [],
		CALLBACK_REGEX = /=\?(&|$)/, 
		jsc = (new Date()).getTime();

	
	// Parse the given XML string. 
	function parseXML(xml) {
		if ( window['DOMParser'] == undefined && window.ActiveXObject ) {
			DOMParser = function() { };
			DOMParser.prototype.parseFromString = function( xmlString ) {
				var doc = new ActiveXObject('Microsoft.XMLDOM');
				doc.async = 'false';
				doc.loadXML( xmlString );
				return doc;
			};
		}

		try {
			var xmlDoc 	= ( new DOMParser() ).parseFromString( xml, 'text/xml' );
			if ( $.isXMLDoc( xmlDoc ) ) {
				var err = $('parsererror', xmlDoc);
				if ( err.length == 1 ) {
					throw('Error: ' + $(xmlDoc).text() );
				}
			} else {
				throw('Unable to parse XML');
			}
		} catch( e ) {
			var msg = ( e.name == undefined ? e : e.name + ': ' + e.message );
			$(document).trigger('xmlParseError', [ msg ]);
			return undefined;
		}
		return xmlDoc;
	}

	// Trigger a jQuery event
	function trigger(s, type, args) {
		(s.context ? jQuery(s.context) : jQuery.event).trigger(type, args);
	}

	// Check if the data field on the mock handler and the request match. This 
	// can be used to restrict a mock handler to being used only when a certain
	// set of data is passed to it.
	function isMockDataEqual( mock, live ) {
		var identical = false;
		// Test for situations where the data is a querystring (not an object)
		if (typeof live === 'string') {
			// Querystring may be a regex
			return $.isFunction( mock.test ) ? mock.test(live) : mock == live;
		}
		$.each(mock, function(k, v) {
			if ( live[k] === undefined ) {
				identical = false;
				return identical;
			} else {
				identical = true;
				if ( typeof live[k] == 'object' ) {
					return isMockDataEqual(mock[k], live[k]);
				} else {
					if ( $.isFunction( mock[k].test ) ) {
						identical = mock[k].test(live[k]);
					} else {
						identical = ( mock[k] == live[k] );
					}
					return identical;
				}
			}
		});

		return identical;
	}

	// Check the given handler should mock the given request
	function getMockForRequest( handler, s ) {
		// If the mock was registered with a function, let the function decide if we
		// want to mock this request
		if ( $.isFunction(handler) ) {
			return handler(s);
		}

		// Inspect the URL of the request and check if the mock handler's url
		// matches the url for this ajax request
		if ( $.isFunction(handler.url.test) ) {
			// The user provided a regex for the url, test it
			if ( !handler.url.test( s.url ) ) {
				return null;
			}
		} else {
			// Look for a simple wildcard '*' or a direct URL match
			var star = handler.url.indexOf('*');
			if (handler.url !== s.url && star === -1 || !new RegExp(handler.url.replace(/[-[\]{}()+?.,\\^$|#\s]/g, "\\$&").replace('*', '.+')).test(s.url)) {
				return null;
			}
		}

		// Inspect the data submitted in the request (either POST body or GET query string)
		if ( handler.data && s.data ) {
			if ( !isMockDataEqual(handler.data, s.data) ) {
				// They're not identical, do not mock this request
				return null;
			}
		}
		// Inspect the request type
		if ( handler && handler.type && handler.type.toLowerCase() != s.type.toLowerCase() ) {
			// The request type doesn't match (GET vs. POST)
			return null;
		}

		return handler;
	}

	// If logging is enabled, log the mock to the console
	function logMock( mockHandler, s ) {
		var c = $.extend({}, $.mockjaxSettings, mockHandler);
		if ( c.log && $.isFunction(c.log) ) {
			c.log('MOCK ' + s.type.toUpperCase() + ': ' + s.url, $.extend({}, s));
		}
	}

	function _xhrSend(k, m, s, origSettings, mockHandlers) {
		mockHandlers[k].fired = true;

		// This is a substitute for < 1.4 which lacks $.proxy
		var process = (function(that) {
			return function() {
				return (function() {
					// The request has returned
					this.status 		= m.status;
					this.statusText		= m.statusText;
					this.readyState 	= 4;

					// We have an executable function, call it to give
					// the mock handler a chance to update it's data
					if ( $.isFunction(m.response) ) {
						m.response(origSettings);
					}
					// Copy over our mock to our xhr object before passing control back to
					// jQuery's onreadystatechange callback
					if ( s.dataType == 'json' && ( typeof m.responseText == 'object' ) ) {
						this.responseText = JSON.stringify(m.responseText);
					} else if ( s.dataType == 'xml' ) {
						if ( typeof m.responseXML == 'string' ) {
							this.responseXML = parseXML(m.responseXML);
						} else {
							this.responseXML = m.responseXML;
						}
					} else {
						this.responseText = m.responseText;
					}
					if( typeof m.status == 'number' || typeof m.status == 'string' ) {
						this.status = m.status;
					}
					if( typeof m.statusText === "string") {
						this.statusText = m.statusText;
					}
					// jQuery < 1.4 doesn't have onreadystate change for xhr
					if ( $.isFunction(this.onreadystatechange) && !m.isTimeout ) {
						this.onreadystatechange( m.isTimeout ? 'timeout' : undefined );
					} else if ( m.isTimeout ) {
						if ( $.isFunction( $.handleError ) ) {
							// Fix for 1.3.2 timeout to keep success from firing.
							this.readyState = -1;
						}
						s.error( this, "timeout" );
						s.complete( this, "timeout" );
					}
				}).apply(that);
			};
		})(this);

		if ( m.proxy ) {
			// We're proxying this request and loading in an external file instead
			_ajax({
				global: false,
				url: m.proxy,
				type: m.proxyType,
				data: m.data,
				dataType: s.dataType === "script" ? "text/plain" : s.dataType,
				complete: function(xhr, txt) {
					m.responseXML = xhr.responseXML;
					m.responseText = xhr.responseText;
					m.status = xhr.status;
					m.statusText = xhr.statusText;
					this.responseTimer = setTimeout(process, m.responseTime || 0);
				}
			});
		} else {
			// type == 'POST' || 'GET' || 'DELETE'
			if ( s.async === false ) {
				// TODO: Blocking delay
				process();
			} else {
				this.responseTimer = setTimeout(process, m.responseTime || 50);
			}
		}
	}

	// Construct a mocked XHR Object
	function xhr(k, m, s, origSettings, mockHandlers) {
		// Extend with our default mockjax settings
		m = $.extend({}, $.mockjaxSettings, m);

		if (typeof m.headers === 'undefined') {
			m.headers = {};
		}
		if ( m.contentType ) {
			m.headers['content-type'] = m.contentType;
		}

		return {
			status: m.status,
			statusText: m.statusText,
			readyState: 1,
			open: function() { },
			send: function() {
				_xhrSend.call(this, k, m, s, origSettings, mockHandlers);
			},
			abort: function() {
				clearTimeout(this.responseTimer);
			},
			setRequestHeader: function(header, value) {
				m.headers[header] = value;
			},
			getResponseHeader: function(header) {
				// 'Last-modified', 'Etag', 'content-type' are all checked by jQuery
				if ( m.headers && m.headers[header] ) {
					// Return arbitrary headers
					return m.headers[header];
				} else if ( header.toLowerCase() == 'last-modified' ) {
					return m.lastModified || (new Date()).toString();
				} else if ( header.toLowerCase() == 'etag' ) {
					return m.etag || '';
				} else if ( header.toLowerCase() == 'content-type' ) {
					return m.contentType || 'text/plain';
				}
			},
			getAllResponseHeaders: function() {
				var headers = '';
				$.each(m.headers, function(k, v) {
					headers += k + ': ' + v + "\n";
				});
				return headers;
			}
		};
	}

	// Process a JSONP mock request.
	function processJsonpMock( s, mockHandler, origSettings ) {
		// Handle JSONP Parameter Callbacks, we need to replicate some of the jQuery core here
		// because there isn't an easy hook for the cross domain script tag of jsonp

		processJsonpUrl( s );

		s.dataType = "json";
		if(s.data && CALLBACK_REGEX.test(s.data) || CALLBACK_REGEX.test(s.url)) {
			createJsonpCallback(s, mockHandler);

			// We need to make sure
			// that a JSONP style response is executed properly

			var rurl = /^(\w+:)?\/\/([^\/?#]+)/,
				parts = rurl.exec( s.url ),
				remote = parts && (parts[1] && parts[1] !== location.protocol || parts[2] !== location.host);

			s.dataType = "script";
			if(s.type.toUpperCase() === "GET" && remote ) {
				var newMockReturn = processJsonpRequest( s, mockHandler, origSettings );

				// Check if we are supposed to return a Deferred back to the mock call, or just 
				// signal success
				if(newMockReturn) {
					return newMockReturn;
				} else {
					return true;
				}
			}
		}
		return null;
	}

	// Append the required callback parameter to the end of the request URL, for a JSONP request
	function processJsonpUrl( s ) {
		if ( s.type.toUpperCase() === "GET" ) {
			if ( !CALLBACK_REGEX.test( s.url ) ) {
				s.url += (/\?/.test( s.url ) ? "&" : "?") + (s.jsonp || "callback") + "=?";
			}
		} else if ( !s.data || !CALLBACK_REGEX.test(s.data) ) {
			s.data = (s.data ? s.data + "&" : "") + (s.jsonp || "callback") + "=?";
		}
	}
	
	// Process a JSONP request by evaluating the mocked response text
	function processJsonpRequest( s, mockHandler, origSettings ) {
		// Synthesize the mock request for adding a script tag
		var callbackContext = origSettings && origSettings.context || s,
			newMock = null;


		// If the response handler on the moock is a function, call it
		if ( mockHandler.response && $.isFunction(mockHandler.response) ) {
			mockHandler.response(origSettings);
		} else {

			// Evaluate the responseText javascript in a global context
			if( typeof mockHandler.responseText === 'object' ) {
				$.globalEval( '(' + JSON.stringify( mockHandler.responseText ) + ')');
			} else {
				$.globalEval( '(' + mockHandler.responseText + ')');
			}
		}

		// Successful response
		jsonpSuccess( s, mockHandler );
		jsonpComplete( s, mockHandler );

		// If we are running under jQuery 1.5+, return a deferred object
		if(jQuery.Deferred){
			newMock = new jQuery.Deferred();
			if(typeof mockHandler.responseText == "object"){
				newMock.resolve( mockHandler.responseText );
			}
			else{
				newMock.resolve( jQuery.parseJSON( mockHandler.responseText ) );
			}
		}
		return newMock;
	}


	// Create the required JSONP callback function for the request
	function createJsonpCallback( s, mockHandler ) {
		jsonp = s.jsonpCallback || ("jsonp" + jsc++);

		// Replace the =? sequence both in the query string and the data
		if ( s.data ) {
			s.data = (s.data + "").replace(CALLBACK_REGEX, "=" + jsonp + "$1");
		}

		s.url = s.url.replace(CALLBACK_REGEX, "=" + jsonp + "$1");


		// Handle JSONP-style loading
		window[ jsonp ] = window[ jsonp ] || function( tmp ) {
			data = tmp;
			jsonpSuccess( s, mockHandler );
			jsonpComplete( s, mockHandler );
			// Garbage collect
			window[ jsonp ] = undefined;

			try {
				delete window[ jsonp ];
			} catch(e) {}

			if ( head ) {
				head.removeChild( script );
			}
		};
	}

	// The JSONP request was successful
	function jsonpSuccess(s, mockHandler) {
		// If a local callback was specified, fire it and pass it the data
		if ( s.success ) {
			s.success.call( callbackContext, ( mockHandler.response ? mockHandler.response.toString() : mockHandler.responseText || ''), status, {} );
		}

		// Fire the global callback
		if ( s.global ) {
			trigger(s, "ajaxSuccess", [{}, s] );
		}
	}

	// The JSONP request was completed
	function jsonpComplete(s, mockHandler) {
		// Process result
		if ( s.complete ) {
			s.complete.call( callbackContext, {} , status );
		}

		// The request was completed
		if ( s.global ) {
			trigger( "ajaxComplete", [{}, s] );
		}

		// Handle the global AJAX counter
		if ( s.global && ! --jQuery.active ) {
			jQuery.event.trigger( "ajaxStop" );
		}
	}


	// The $.ajax replacement.  Where the magic happens
	function handleAjax( url, origSettings ) {
		var mockRequest, s, mockHandler;

		// If url is an object, simulate pre-1.5 signature
		if ( typeof url === "object" ) {
			origSettings = url;
			url = undefined;
		} else {
			// work around to support 1.5 signature
			origSettings.url = url;
		}
		
		// Extend the original settings for the request
		s = jQuery.extend(true, {}, jQuery.ajaxSettings, origSettings);

		// Iterate over our mock handlers (in registration order) until we find
		// one that is willing to intercept the request
		for(var k = 0; k < mockHandlers.length; k++) {
			if ( !mockHandlers[k] ) {
				continue;
			}
			
			mockHandler = getMockForRequest( mockHandlers[k], s );
			if(!mockHandler) {
				// No valid mock found for this request
				continue;
			}

			// Handle console logging
			logMock( mockHandler, s );


			if ( s.dataType === "jsonp" ) {
				if ((mockRequest = processJsonpMock( s, mockHandler, origSettings ))) {
					// This mock will handle the JSONP request
					return mockRequest;
				}
			}


			// Removed to fix #54 - keep the mocking data object intact
			//m.data = s.data;

			mockHandler.cache = s.cache;
			mockHandler.timeout = s.timeout;
			mockHandler.global = s.global;

			(function(k, mockHandler, s, origSettings, mockHandlers) {
				mockRequest = _ajax.call($, $.extend(true, {}, origSettings, {
					// Mock the XHR object
					xhr: function() { return xhr(k, mockHandler, s, origSettings, mockHandlers); }
				}));
			})(k, mockHandler, s, origSettings, mockHandlers);

			return mockRequest;
		}

		// We don't have a mock request, trigger a normal request
		return _ajax.apply($, [origSettings]);
	}


	// Public

	$.extend({
		ajax: handleAjax
	});

	$.mockjaxSettings = {
		//url:        null,
		//type:       'GET',
		log:          function(msg) {
						window['console'] && window.console.log && window.console.log(msg);
					  },
		status:       200,
		statusText:   "OK",
		responseTime: 500,
		sisTimeout:    false,
		contentType:  'text/plain',
		response:     '',
		responseText: '',
		responseXML:  '',
		proxy:        '',
		proxyType:    'GET',

		lastModified: null,
		etag:         '',
		headers: {
			etag: 'IJF@H#@923uf8023hFO@I#H#',
			'content-type' : 'text/plain'
		}
	};

	$.mockjax = function(settings) {
		var i = mockHandlers.length;
		mockHandlers[i] = settings;
		return i;
	};
	$.mockjaxClear = function(i) {
		if ( arguments.length == 1 ) {
			mockHandlers[i] = null;
		} else {
			mockHandlers = [];
		}
	};
	$.mockjax.handler = function(i) {
	  if ( arguments.length == 1 ) {
			return mockHandlers[i];
		}
	};
})(jQuery);

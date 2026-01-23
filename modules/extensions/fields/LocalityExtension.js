import localityPredictionsTemplate from '../../../templates/locality_predictions.html';
import { diffChars } from 'diff';

/**
 * Maximum number of predictions displayed before adding scroll functionality
 * @type {number}
 */
const MAX_PREDICTIONS_BEFORE_SCROLL = 6;

/**
 * Error code indicating an expired session
 * @type {number}
 */
const ERROR_EXPIRED_SESSION = -32700;

/**
 * Default predictions index value (no selection)
 * @type {number}
 */
const PREDICTIONS_INDEX_DEFAULT = -1;

const LocalityExtension = {
    name: 'LocalityExtension',

    /**
     * Registers required properties on the extendable object
     * @param {Object} ExtendableObject - The object to extend with locality properties
     */
    registerProperties: (ExtendableObject) => {
        ExtendableObject._locality = '';
        ExtendableObject._subscribers.locality = [];

        // Add fields.
        ExtendableObject._localityAutocompleteRequestIndex = 1;
        ExtendableObject._localityChunk = '';
        ExtendableObject._localityPredictions = [];
        ExtendableObject._localityPredictionsIndex = PREDICTIONS_INDEX_DEFAULT;
        ExtendableObject._localityTimeout = null;

        ExtendableObject._allowToNotifyLocalitySubscribers = true;
        ExtendableObject._allowFetchLocalityAutocomplete = false;

        ExtendableObject.localityAutocompleteCache = {
            cachedResults: {}
        };

        ExtendableObject._localityAutocompleteTimeout = null;

        ExtendableObject._subscribers.localityChunk = [];

        ExtendableObject._directionUp = 'up';
        ExtendableObject._directionDown = 'down';
    },

    /**
     * Registers getters, setters and field methods on the extendable object
     * @param {Object} ExtendableObject - The object to extend with locality fields
     */
    registerFields: (ExtendableObject) => {
        // Add getter and setter for fields.
        Object.defineProperty(ExtendableObject, 'locality', {
            get: () => {
                return ExtendableObject.getLocality();
            },
            set: async (value) => {
                await ExtendableObject.setLocality(value);
            }
        });

        /**
         * Gets the current locality value
         * @returns {string} The current locality value
         */
        ExtendableObject.getLocality = () => {
            return ExtendableObject._locality;
        };

        /**
         * Sets the locality value and triggers notifications and autocomplete
         * @param {string} locality - The new locality value to set
         * @returns {Promise<void>}
         */
        ExtendableObject.setLocality = async (locality) => {
            const needToNotify = ExtendableObject.active && ExtendableObject._allowToNotifyLocalitySubscribers;
            const needToDisplayAutocompleteDropdown = ExtendableObject.active &&
                ExtendableObject.config.useAutocomplete &&
                ExtendableObject._allowFetchLocalityAutocomplete;

            ExtendableObject._awaits++;

            try {
                let resolvedValue = await ExtendableObject.util.Promise.resolve(locality);

                resolvedValue = await ExtendableObject.cb.setLocality(resolvedValue);

                // Early return.
                if (resolvedValue === ExtendableObject._locality) {
                    return;
                }

                ExtendableObject._locality = resolvedValue;

                if (needToNotify) {
                    // Inform all subscribers about the change.
                    const notificationProcesses = [];

                    ExtendableObject._subscribers.locality.forEach((subscriber) => {
                        notificationProcesses.push(subscriber.updateDOMValue(resolvedValue));
                    });
                    await Promise.all(notificationProcesses);
                }

                if (needToDisplayAutocompleteDropdown) {
                    // eslint-disable-next-line no-unused-vars
                    const _ = ExtendableObject.util.displayLocalityAutocompleteDropdown(resolvedValue);
                }
            } catch (e) {
                console.warn("Error while setting the field 'locality'", e);
            } finally {
                ExtendableObject._awaits--;
            }
        };
        ExtendableObject.fieldNames.push('locality');

        Object.defineProperty(ExtendableObject, 'localityPredictions', {
            get: () => {
                return ExtendableObject.getLocalityPredictions();
            },
            set: (value) => {
                return ExtendableObject.setLocalityPredictions(value);
            }
        });

        /**
         * Gets the current locality predictions array
         * @returns {Array} Array of prediction objects
         */
        ExtendableObject.getLocalityPredictions = () => {
            return ExtendableObject._localityPredictions;
        };

        /**
         * Sets the locality predictions array after processing by callbacks
         * @param {Array} value - Array of prediction objects
         * @returns {Promise<void>}
         */
        ExtendableObject.setLocalityPredictions = async (value) => {
            ExtendableObject._awaits++;

            try {
                let resolvedValue = await ExtendableObject.util.Promise.resolve(value);

                resolvedValue = await ExtendableObject.cb.setLocalityPredictions(resolvedValue);

                // Early return.
                if (resolvedValue === ExtendableObject._localityPredictions) {
                    return;
                }

                ExtendableObject._localityPredictions = resolvedValue;
            } catch (e) {
                console.warn("Error while setting the field 'localityPredictions'", e);
            } finally {
                ExtendableObject._awaits--;
            }
        };
    },

    /**
     * Registers configuration templates for the locality extension
     * @param {Object} ExtendableObject - The object to extend with config templates
     */
    registerConfig: (ExtendableObject) => {
        // Add config templates.
        ExtendableObject.config.templates.localityPredictions = localityPredictionsTemplate;
    },

    /**
     * Registers event callbacks for locality-related user interactions
     * @param {Object} ExtendableObject - The object to extend with event callbacks
     */
    registerEventCallbacks: (ExtendableObject) => {
        /**
         * Handler for field value changes via normal input events (without the field being in focus)
         * @param {Object} subscriber - The subscriber object that triggered the change
         * @returns {Function} Event handler that updates locality while preventing circular updates
         */
        ExtendableObject.cb.localityChange = (subscriber) => {
            return () => {
                ExtendableObject._allowToNotifyLocalitySubscribers = false;
                ExtendableObject._allowFetchLocalityAutocomplete = false;
                ExtendableObject.locality = subscriber.value;
                ExtendableObject._allowToNotifyLocalitySubscribers = true;

                if (ExtendableObject.active) {
                    ExtendableObject.util.invalidateAddressMeta();
                }
            };
        };

        /**
         * Handler for field value changes via direct input events (while being in focus)
         * @param {Object} subscriber - The subscriber object that triggered the input
         * @returns {Function} Event handler that updates locality while preventing circular updates
         */
        ExtendableObject.cb.localityInput = (subscriber) => {
            return () => {
                ExtendableObject._allowToNotifyLocalitySubscribers = false;
                ExtendableObject._allowFetchLocalityAutocomplete = true;
                ExtendableObject.locality = subscriber.value;
                ExtendableObject._allowToNotifyLocalitySubscribers = true;
                ExtendableObject._allowFetchLocalityAutocomplete = false;

                if (ExtendableObject.active) {
                    ExtendableObject.util.invalidateAddressMeta();
                }
            };
        };

        /**
         * Handler for blur events on locality field
         * Triggers address validation after timeout if configured
         * @param {Object} subscriber - The subscriber object that triggered the blur
         * @returns {Function} Event handler for blur events
         */
        ExtendableObject.cb.localityBlur = function (subscriber) {
            return async (e) => {
                const isAnyActive = ExtendableObject._subscribers.locality.some(sub =>
                    document.activeElement === sub.object);

                if (!isAnyActive) {
                    // Reset values and remove dropdown
                    ExtendableObject.localityPredictions = [];
                    ExtendableObject._localityPredictionsIndex = PREDICTIONS_INDEX_DEFAULT;
                    ExtendableObject.util.removeLocalityPredictionsDropdown();
                }

                try {
                    await ExtendableObject.waitForPredictionApplication();
                    await ExtendableObject.waitUntilReady();
                    await ExtendableObject.cb.handleFormBlur();
                } catch (error) {
                    console.warn('Error in localityBlur handler:', error);
                }
            };
        };

        /**
         * Handler for keyboard events on the locality field
         * Manages keyboard navigation within the predictions dropdown
         * @returns {Function} Event handler that manages keyboard navigation and selection
         */
        ExtendableObject.cb.localityKeydown = () => {
            return function (e) {
                if (e.key === 'ArrowUp' || e.key === 'Up') {
                    e.preventDefault();
                    e.stopPropagation();
                    if (ExtendableObject._localityPredictionsIndex > PREDICTIONS_INDEX_DEFAULT) {
                        ExtendableObject._localityPredictionsIndex = ExtendableObject._localityPredictionsIndex - 1;
                        ExtendableObject.util.renderLocalityPredictionsDropdown(ExtendableObject._directionUp);
                    }
                    // Arrow up at no selection does nothing (stays at -1)
                } else if (e.key === 'ArrowDown' || e.key === 'Down') {
                    e.preventDefault();
                    e.stopPropagation();
                    if (ExtendableObject._localityPredictionsIndex < (ExtendableObject._localityPredictions.length - 1)) {
                        ExtendableObject._localityPredictionsIndex = ExtendableObject._localityPredictionsIndex + 1;
                    } else {
                        ExtendableObject._localityPredictionsIndex = 0;
                    }
                    ExtendableObject.util.renderLocalityPredictionsDropdown(ExtendableObject._directionDown);
                } else if (e.key === 'Home') {
                    e.preventDefault();
                    e.stopPropagation();
                    ExtendableObject._localityPredictionsIndex = 0;
                    ExtendableObject.util.renderLocalityPredictionsDropdown();
                } else if (e.key === 'End') {
                    e.preventDefault();
                    e.stopPropagation();
                    ExtendableObject._localityPredictionsIndex = ExtendableObject._localityPredictions.length - 1;
                    ExtendableObject.util.renderLocalityPredictionsDropdown();
                } else if (e.key === 'Escape') {
                    if (ExtendableObject._localityPredictions.length) {
                        e.preventDefault();
                        e.stopPropagation();
                    }
                    ExtendableObject.resetLocalityPredictions();
                    ExtendableObject.util.removeLocalityPredictionsDropdown();
                } else if (e.key === 'Tab') {
                    if (ExtendableObject._localityPredictions.length > 0 && ExtendableObject._localityPredictionsIndex >= 0) {
                        e.preventDefault();

                        (async () => {
                            await ExtendableObject.cb.applyLocalityPredictionSelection(
                                ExtendableObject._localityPredictionsIndex,
                                ExtendableObject._localityPredictions
                            );
                            ExtendableObject.resetLocalityPredictions();
                            ExtendableObject.util.removeLocalityPredictionsDropdown();

                            // Find next focusable element
                            const focusableElements = Array.from(document.querySelectorAll(
                                'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])'
                            ));
                            const currentIndex = focusableElements.indexOf(e.target);
                            const nextElement = e.shiftKey
                                ? focusableElements[currentIndex - 1]
                                : focusableElements[currentIndex + 1];

                            if (nextElement) {
                                nextElement.focus();
                            }
                        })();
                    }
                } else if (e.key === 'Enter' || e.key === 'Enter') {
                    if (ExtendableObject._localityPredictions.length > 0 && ExtendableObject._localityPredictionsIndex >= 0) {
                        e.preventDefault();
                        e.stopImmediatePropagation();

                        (async () => {
                            await ExtendableObject.cb.applyLocalityPredictionSelection(
                                ExtendableObject._localityPredictionsIndex,
                                ExtendableObject._localityPredictions
                            );
                            ExtendableObject.resetLocalityPredictions();
                            ExtendableObject.util.removeLocalityPredictionsDropdown();
                        })();
                    } else {
                        ExtendableObject.util.removeLocalityPredictionsDropdown();
                    }
                } else if (e.key === 'Backspace' || e.key === 'Backspace') {
                    ExtendableObject.config.ux.smartFill = false;
                }
            };
        };

        /**
         * Applies the selected prediction to the form fields
         * Updates locality, postal code, and subdivision code as available
         * @param {number} index - Selected prediction index
         * @param {Array} predictions - Array of available predictions
         */
        ExtendableObject.cb.applyLocalityPredictionSelection = async (index, predictions) => {
            const applicationPromise = (async () => {
                ExtendableObject._allowFetchLocalityAutocomplete = false;
                ExtendableObject._allowFetchPostalCodeAutocomplete = false;
                await ExtendableObject.setLocality(predictions[index].locality);

                if (predictions[index].postalCode && predictions[index].postalCode !== '') {
                    await ExtendableObject.setPostalCode(predictions[index].postalCode);
                }

                if (predictions[index].subdivisionCode && predictions[index].subdivisionCode !== '') {
                    await ExtendableObject.setSubdivisionCode(predictions[index].subdivisionCode);
                }
                ExtendableObject._allowFetchLocalityAutocomplete = true;
                ExtendableObject._allowFetchPostalCodeAutocomplete = false;
            })();

            ExtendableObject._activePredictionApplications.push(applicationPromise);
            await applicationPromise.finally(() => {
                const index = ExtendableObject._activePredictionApplications.indexOf(applicationPromise);

                if (index > -1) {
                    ExtendableObject._activePredictionApplications.splice(index, 1);
                }
            });

            return applicationPromise;
        };

        /**
         * Resets locality predictions state
         * Clears predictions array and resets selection index
         */
        ExtendableObject.resetLocalityPredictions = () => {
            ExtendableObject.localityPredictions = [];
            ExtendableObject._localityPredictionsIndex = PREDICTIONS_INDEX_DEFAULT;
        };
    },

    /**
     * Registers utility functions for locality functionality
     * @param {Object} ExtendableObject - The object to extend with utility methods
     */
    registerUtilities: (ExtendableObject) => {
        /**
         * Manages the display of autocomplete suggestions dropdown
         * Debounces API calls and renders results when available
         * @param {string} locality - Current locality input value
         * @returns {Promise<void>}
         */
        ExtendableObject.util.displayLocalityAutocompleteDropdown = (locality) => {
            ExtendableObject.util.removeLocalityPredictionsDropdown();

            if (ExtendableObject._localityAutocompleteTimeout) {
                clearTimeout(ExtendableObject._localityAutocompleteTimeout);
            }

            ExtendableObject._localityAutocompleteTimeout = setTimeout(async () => {
                ExtendableObject._localityAutocompleteTimeout = null;
                try {
                    const autocompleteResult = await ExtendableObject.util.getLocalityPredictions(locality);
                    const currentLocality = ExtendableObject.getLocality();

                    if (autocompleteResult.originalLocality !== currentLocality) {
                        return;
                    }

                    ExtendableObject._localityPredictionsIndex = PREDICTIONS_INDEX_DEFAULT;
                    await ExtendableObject.setLocalityPredictions(autocompleteResult.predictions);
                    ExtendableObject.util.renderLocalityPredictionsDropdown();
                } catch (err) {
                    console.warn('Failed fetching predictions', {
                        error: err,
                        locality
                    });
                }
            }, ExtendableObject.config.ux.delay.inputAssistant);
        };

        /**
         * Removes the predictions dropdown from the DOM
         * Cleans up any existing dropdown elements
         * @param {string} inputId - Optional input element ID to remove dropdown for specific input only
         */
        ExtendableObject.util.removeLocalityPredictionsDropdown = (inputId = '') => {
            let selector = '[endereco-locality-predictions]';

            // If inputId is provided, target specific dropdown
            if (inputId) {
                selector = `[endereco-locality-predictions][data-input-id="${inputId}"]`;
            }

            const dropdowns = inputId ? [document.querySelector(selector)] : document.querySelectorAll(selector);

            dropdowns.forEach(dropdown => {
                if (dropdown) {
                    dropdown.parentNode.removeChild(dropdown);
                }
            });
        };

        /**
         * Renders the predictions dropdown with diff highlighting
         * Handles dropdown positioning, diff highlighting, and event listeners
         */
        ExtendableObject.util.renderLocalityPredictionsDropdown = (scrollDirection = null) => {
            // TODO: this has to be moved to parameters, as well as keydown callbacks.
            const originalLocality = ExtendableObject.getLocality();
            const predictions = ExtendableObject.getLocalityPredictions();

            // Save predictions container scroll state
            ExtendableObject.scrollState = null;
            if (
                scrollDirection === ExtendableObject._directionUp ||
                scrollDirection === ExtendableObject._directionDown
            ) {
                const currentActiveItem = document.querySelector(
                    '[endereco-locality-predictions] .endereco-predictions__item.active'
                );

                if (currentActiveItem) {
                    const container = currentActiveItem.closest('.endereco-predictions');

                    const itemTop = currentActiveItem.offsetTop;
                    const itemBottom = itemTop + currentActiveItem.offsetHeight;

                    const viewTop = container.scrollTop;
                    const viewBottom = viewTop + container.clientHeight;

                    const isVisible = itemBottom > viewTop && itemTop < viewBottom;

                    if (isVisible) {
                        // keep relative position
                        ExtendableObject.scrollState = {
                            mode: 'keep',
                            scrollTop: container.scrollTop
                        };
                    } else {
                        // Active item is outside viewport → force positioning
                        ExtendableObject.scrollState = {
                            mode: 'force',
                            direction: scrollDirection
                        };
                    }
                }
            }

            // Is subdivision visible?
            let isSubdivisionVisible = false;

            if (ExtendableObject.util.hasSubscribedField('subdivisionCode')) {
                isSubdivisionVisible = true;
            }

            // Render dropdown under the input element
            ExtendableObject._subscribers.locality.forEach(function (subscriber) {
                // Ensure the input element has an ID for accessibility
                if (!subscriber.object.id) {
                    subscriber.object.id = ExtendableObject.util.generateUniqueId('endereco');
                }

                // Remove only the dropdown associated with this specific input
                ExtendableObject.util.removeLocalityPredictionsDropdown(subscriber.object.id);

                // Render predictions only if the field is active and there are predictions.
                if (
                    predictions.length > 0 &&
                    (document.activeElement === subscriber.object)
                ) {
                    let startingIndex = 0;
                    const preparedPredictions = [];

                    // Prepare predictions.
                    predictions.forEach(function (prediction) {
                        const diff = diffChars(originalLocality, prediction.locality, { ignoreCase: true });
                        let localityHtml = '';

                        diff.forEach(function (part) {
                            const markClass = part.added
                                ? 'endereco-span--add'
                                : part.removed ? 'endereco-span--remove' : 'endereco-span--neutral';

                            // Security fix: Escape HTML entities before building HTML string
                            const escapedValue = ExtendableObject.util.escapeHTML(part.value);

                            localityHtml += `<span class="${markClass}">${escapedValue}</span>`;
                        });

                        const tempData = {
                            postalCode: prediction.postalCode,
                            locality: prediction.locality,
                            localityDiff: localityHtml
                        };

                        if (isSubdivisionVisible && prediction.subdivisionCode) {
                            tempData.subdivisionCode = prediction.subdivisionCode;
                            if (window.EnderecoIntegrator.subdivisionCodeToNameMapping &&
                                window.EnderecoIntegrator.subdivisionCodeToNameMapping[prediction.subdivisionCode.toUpperCase()]
                            ) {
                                tempData.subdivisionName = window.EnderecoIntegrator.subdivisionCodeToNameMapping[
                                    prediction.subdivisionCode.toUpperCase()
                                ];
                            } else {
                                if (prediction.subdivisionCode.toUpperCase()) {
                                    tempData.subdivisionName = prediction.subdivisionCode.split('-')[1];
                                } else {
                                    tempData.subdivisionName = '&nbsp;';
                                }
                            }
                        }

                        preparedPredictions.push(tempData);
                    });

                    // Prepare dropdown.
                    const predictionsHtml = ExtendableObject.util.Mustache.render(ExtendableObject.config.templates.localityPredictions, {
                        ExtendableObject,
                        predictions: preparedPredictions,
                        inputId: subscriber.object.id,
                        offsetTop: subscriber.object.offsetTop + subscriber.object.offsetHeight,
                        offsetLeft: subscriber.object.offsetLeft,
                        width: subscriber.object.offsetWidth,
                        direction: getComputedStyle(subscriber.object).direction,
                        longList: (preparedPredictions.length > MAX_PREDICTIONS_BEFORE_SCROLL),
                        index: function () {
                            return (startingIndex - 1); // TODO: add loop finishing function to increase counter.
                        },
                        isActive: function () {
                            const isActive = (startingIndex === ExtendableObject._localityPredictionsIndex);

                            startingIndex++;

                            return isActive;
                        }
                    });

                    // Attach it to HTML.
                    subscriber.object.insertAdjacentHTML('afterend', predictionsHtml);

                    // Scroll active item into view
                    setTimeout(() => {
                        const activeItem = document.querySelector('[endereco-locality-predictions] .endereco-predictions__item.active');

                        if (ExtendableObject._localityPredictionsIndex === 0) {
                            activeItem.scrollIntoView({ block: 'nearest' });

                            return;
                        }

                        if (
                            activeItem &&
                            ExtendableObject.scrollState &&
                            (scrollDirection === ExtendableObject._directionUp ||
                             scrollDirection === ExtendableObject._directionDown)
                        ) {
                            const container = activeItem.closest('.endereco-predictions');

                            if (ExtendableObject.scrollState.mode === 'keep') {
                                // Restore previous scroll position
                                container.scrollTop = ExtendableObject.scrollState.scrollTop;

                                const itemTop = activeItem.offsetTop;
                                const itemBottom = itemTop + activeItem.offsetHeight;

                                const viewTop = container.scrollTop;
                                const viewBottom = viewTop + container.clientHeight;

                                if (scrollDirection === ExtendableObject._directionUp && itemTop < viewTop) {
                                    container.scrollTop = itemTop;
                                }

                                if (scrollDirection === ExtendableObject._directionDown && itemBottom > viewBottom) {
                                    container.scrollTop = itemBottom - container.clientHeight;
                                }
                            }

                            if (ExtendableObject.scrollState.mode === 'force') {
                                // Force active item into viewport
                                if (ExtendableObject.scrollState.direction === ExtendableObject._directionDown) {
                                    container.scrollTop = activeItem.offsetTop;
                                }

                                if (ExtendableObject.scrollState.direction === ExtendableObject._directionUp) {
                                    container.scrollTop =
                                        activeItem.offsetTop -
                                        container.clientHeight +
                                        activeItem.offsetHeight;
                                }
                            }
                        } else {
                            if (activeItem) {
                                activeItem.scrollIntoView({ block: 'nearest' });
                            }
                        }
                    }, 0);

                    document.querySelectorAll(`[data-id="${ExtendableObject.id}"] [endereco-locality-prediction]`).forEach((DOMElement) => {
                        DOMElement.addEventListener('mousedown', (e) => {
                            const index = parseInt(DOMElement.getAttribute('data-prediction-index'));

                            e.preventDefault();
                            e.stopPropagation();

                            ExtendableObject.cb.applyLocalityPredictionSelection(
                                index,
                                predictions
                            );

                            ExtendableObject.localityPredictions = [];
                            ExtendableObject.util.removeLocalityPredictionsDropdown();
                        });
                    });
                }
            });
        };
    },

    /**
     * Registers API interaction handlers for locality data
     * @param {Object} ExtendableObject - The object to extend with API handlers
     */
    registerAPIHandlers: (ExtendableObject) => {
        /**
         * Fetches locality predictions from the Endereco API
         * Handles caching, request formation, and response processing
         *
         * @param {string} localityRaw - Raw locality input to get predictions for
         * @returns {Promise<Object>} Prediction results with original input
         * @throws {Error} If input is invalid or API request fails
         */
        ExtendableObject.util.getLocalityPredictions = async function (localityRaw) {
            if (typeof localityRaw !== 'string') {
                throw new Error('Invalid argument. The localityRaw has to be a string');
            }

            const locality = localityRaw.trim();
            const autocompleteResult = {
                originalLocality: locality,
                predictions: []
            };

            // Early return
            if (locality === '') {
                return autocompleteResult;
            }

            const cacheKeyData = [
                ExtendableObject.countryCode,
                ExtendableObject.config.lang,
                locality
            ];

            if (ExtendableObject.util.hasSubscribedField('subdivisionCode')) {
                cacheKeyData.push(ExtendableObject.getSubdivisionCode());
            }

            const cacheKey = cacheKeyData.join('-');

            if (!ExtendableObject.localityAutocompleteCache.cachedResults[cacheKey]) {
                const autocompleteRequestIndex = ++ExtendableObject._localityAutocompleteRequestIndex;

                const message = {
                    jsonrpc: '2.0',
                    id: autocompleteRequestIndex,
                    method: 'cityNameAutocomplete',
                    params: {
                        country: ExtendableObject.countryCode,
                        language: ExtendableObject.config.lang,
                        cityName: locality
                    }
                };

                if (ExtendableObject.util.hasSubscribedField('subdivisionCode')) {
                    message.params.subdivisionCode = ExtendableObject.getSubdivisionCode();
                }

                const headers = {
                    'X-Auth-Key': ExtendableObject.config.apiKey,
                    'X-Agent': ExtendableObject.config.agentName,
                    'X-Remote-Api-Url': ExtendableObject.config.remoteApiUrl,
                    'X-Transaction-Referer': window.location.href,
                    'X-Transaction-Id': ExtendableObject.hasLoadedExtension?.('SessionExtension')
                        ? ExtendableObject.sessionId
                        : 'not_required'
                };

                const localityPredictionsTemp = [];

                const EnderecoAPI = ExtendableObject.getEnderecoAPI();

                if (!EnderecoAPI) {
                    console.warn('EnderecoAPI is not available');

                    return autocompleteResult;
                }

                const result = await EnderecoAPI.sendRequestToAPI(message, headers);

                if (result?.data?.error?.code === ERROR_EXPIRED_SESSION) {
                    ExtendableObject.util.updateSessionId?.();
                }

                if (!result || !result.data || !result.data.result) {
                    console.warn("API didn't return a valid result");

                    return autocompleteResult;
                }

                // If session counter is set, increase it.
                if (ExtendableObject.hasLoadedExtension('SessionExtension')) {
                    ExtendableObject.sessionCounter++;
                }

                result.data.result.predictions.forEach((localityPrediction) => {
                    if (!localityPrediction) return;

                    const { postCode, cityName, subdivisionCode } = localityPrediction || {};

                    const tempLocalityContainer = {
                        postalCode: postCode,
                        locality: cityName
                    };

                    if ((subdivisionCode !== undefined) &&
                            ExtendableObject.util.hasSubscribedField('subdivisionCode')
                    ) {
                        tempLocalityContainer.subdivisionCode = subdivisionCode;
                    }

                    localityPredictionsTemp.push(tempLocalityContainer);
                });

                ExtendableObject.localityAutocompleteCache.cachedResults[cacheKey] = localityPredictionsTemp;
            }

            autocompleteResult.predictions = ExtendableObject.localityAutocompleteCache.cachedResults[cacheKey];

            return autocompleteResult;
        };
    },

    /**
     * Registers filter callbacks that process locality data
     * @param {Object} ExtendableObject - The object to extend with filter callbacks
     */
    registerFilterCallbacks: (ExtendableObject) => {
        /**
         * Filter callback for locality value processing
         * @param {string} locality - The locality value to process
         * @returns {string} The processed locality value
         */
        ExtendableObject.cb.setLocality = (locality) => locality;

        /**
         * Filter callback for locality predictions processing
         * @param {Array} localityPredictions - The predictions array to process
         * @returns {Array} The processed predictions array
         */
        ExtendableObject.cb.setLocalityPredictions = (localityPredictions) => localityPredictions;
    },

    /**
     * Main extension method that applies all locality functionality to the object
     * @param {Object} ExtendableObject - The object to extend with locality functionality
     * @returns {Promise<Object>} The LocalityExtension object
     */
    extend: async (ExtendableObject) => {
        await LocalityExtension.registerProperties(ExtendableObject);
        await LocalityExtension.registerFields(ExtendableObject);
        await LocalityExtension.registerConfig(ExtendableObject);
        await LocalityExtension.registerEventCallbacks(ExtendableObject);
        await LocalityExtension.registerUtilities(ExtendableObject);
        await LocalityExtension.registerAPIHandlers(ExtendableObject);
        await LocalityExtension.registerFilterCallbacks(ExtendableObject);

        return LocalityExtension;
    }
};

export default LocalityExtension;

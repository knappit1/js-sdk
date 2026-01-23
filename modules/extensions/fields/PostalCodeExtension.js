import postalCodePredictionsTemplate from '../../../templates/postal_code_predictions.html';
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
 * Maximum number of autocomplete predictions to show
 * @type {number}
 */
const MAX_AUTOCOMPLETE_PREDICTIONS = 10;

/**
 * Default predictions index value (no selection)
 * @type {number}
 */
const PREDICTIONS_INDEX_DEFAULT = -1;

const PostalCodeExtension = {
    name: 'PostalCodeExtension',

    /**
     * Registers required properties on the extendable object
     * @param {Object} ExtendableObject - The object to extend with postal code properties
     */
    registerProperties: (ExtendableObject) => {
        ExtendableObject._postalCode = '';
        ExtendableObject._subscribers.postalCode = [];

        // Add fields related to autocomplete
        ExtendableObject._postalCodeAutocompleteRequestIndex = 1;
        ExtendableObject._postalCodePredictions = [];
        ExtendableObject._postalCodePredictionsIndex = PREDICTIONS_INDEX_DEFAULT;
        ExtendableObject._postalCodeTimeout = null;

        ExtendableObject._allowToNotifyPostalCodeSubscribers = true;
        ExtendableObject._allowFetchPostalCodeAutocomplete = false;

        ExtendableObject.postalCodeAutocompleteCache = {
            cachedResults: {}
        };

        ExtendableObject._postalCodeAutocompleteTimeout = null;

        ExtendableObject._directionUp = 'up';
        ExtendableObject._directionDown = 'down';
    },

    /**
     * Registers getters, setters and field methods on the extendable object
     * @param {Object} ExtendableObject - The object to extend with postal code fields
     */
    registerFields: (ExtendableObject) => {
        // Add getter and setter for fields.
        Object.defineProperty(ExtendableObject, 'postalCode', {
            get: () => {
                return ExtendableObject.getPostalCode();
            },
            set: async (value) => {
                await ExtendableObject.setPostalCode(value);
            }
        });

        /**
         * Gets the current postal code value
         * @returns {string} The current postal code value
         */
        ExtendableObject.getPostalCode = () => {
            return ExtendableObject._postalCode;
        };

        /**
         * Sets the postal code value and triggers notifications and autocomplete
         * @param {string} postalCode - The new postal code value to set
         * @returns {Promise<void>}
         */
        ExtendableObject.setPostalCode = async (postalCode) => {
            const needToNotify = ExtendableObject.active && ExtendableObject._allowToNotifyPostalCodeSubscribers;
            const needToDisplayAutocompleteDropdown = ExtendableObject.active &&
                ExtendableObject.config.useAutocomplete &&
                ExtendableObject._allowFetchPostalCodeAutocomplete;

            ExtendableObject._awaits++;

            try {
                let resolvedValue = await ExtendableObject.util.Promise.resolve(postalCode);

                resolvedValue = await ExtendableObject.cb.setPostalCode(resolvedValue);

                // Early return
                if (resolvedValue === ExtendableObject._postalCode) {
                    return;
                }

                ExtendableObject._postalCode = resolvedValue;

                if (needToNotify) {
                    // Inform all subscribers about the change.
                    const notificationProcesses = [];

                    ExtendableObject._subscribers.postalCode.forEach((subscriber) => {
                        notificationProcesses.push(subscriber.updateDOMValue(resolvedValue));
                    });
                    await Promise.all(notificationProcesses);
                }

                if (needToDisplayAutocompleteDropdown) {
                    // eslint-disable-next-line no-unused-vars
                    const _ = ExtendableObject.util.displayPostalCodeAutocompleteDropdown(resolvedValue);
                }
            } catch (e) {
                console.warn("Error while setting the field 'postalCode'", e);
            } finally {
                ExtendableObject._awaits--;
            }
        };
        ExtendableObject.fieldNames.push('postalCode');

        Object.defineProperty(ExtendableObject, 'postalCodePredictions', {
            get: () => {
                return ExtendableObject.getPostalCodePredictions();
            },
            set: (value) => {
                return ExtendableObject.setPostalCodePredictions(value);
            }
        });

        /**
         * Gets the current postal code predictions array
         * @returns {Array} Array of prediction objects
         */
        ExtendableObject.getPostalCodePredictions = () => {
            return ExtendableObject._postalCodePredictions;
        };

        /**
         * Sets the postal code predictions array after processing by callbacks
         * @param {Array} value - Array of prediction objects
         * @returns {Promise<void>}
         */
        ExtendableObject.setPostalCodePredictions = async (value) => {
            ExtendableObject._awaits++;

            try {
                let resolvedValue = await ExtendableObject.util.Promise.resolve(value);

                resolvedValue = await ExtendableObject.cb.setPostalCodePredictions(resolvedValue);

                // Early return
                if (resolvedValue === ExtendableObject._postalCodePredictions) {
                    return;
                }

                ExtendableObject._postalCodePredictions = resolvedValue;
            } catch (e) {
                console.warn("Error while setting the field 'postalCodePredictions'", e);
            } finally {
                ExtendableObject._awaits--;
            }
        };
    },

    /**
     * Registers configuration templates for the postal code extension
     * @param {Object} ExtendableObject - The object to extend with config templates
     */
    registerConfig: (ExtendableObject) => {
        // Add config templates.
        ExtendableObject.config.templates.postalCodePredictions = postalCodePredictionsTemplate;
    },

    /**
     * Registers event callbacks for postal code-related user interactions
     * @param {Object} ExtendableObject - The object to extend with event callbacks
     */
    registerEventCallbacks: (ExtendableObject) => {
        /**
         * Handler for field value changes via normal input events (without the field being in focus)
         * @param {Object} subscriber - The subscriber object that triggered the change
         * @returns {Function} Event handler that updates postal code while preventing circular updates
         */
        ExtendableObject.cb.postalCodeChange = (subscriber) => {
            return () => {
                ExtendableObject._allowFetchPostalCodeAutocomplete = false;
                ExtendableObject._allowToNotifyPostalCodeSubscribers = false;
                ExtendableObject.postalCode = subscriber.value;
                ExtendableObject._allowToNotifyPostalCodeSubscribers = true;

                if (ExtendableObject.active) {
                    ExtendableObject.util.invalidateAddressMeta();
                }
            };
        };

        /**
         * Handler for field value changes via direct input events (while being in focus)
         * @param {Object} subscriber - The subscriber object that triggered the input
         * @returns {Function} Event handler that updates postal code while preventing circular updates
         */
        ExtendableObject.cb.postalCodeInput = (subscriber) => {
            return () => {
                ExtendableObject._allowFetchPostalCodeAutocomplete = true;
                ExtendableObject._allowToNotifyPostalCodeSubscribers = false;
                ExtendableObject.postalCode = subscriber.value;
                ExtendableObject._allowToNotifyPostalCodeSubscribers = true;
                ExtendableObject._allowFetchPostalCodeAutocomplete = false;

                if (ExtendableObject.active) {
                    ExtendableObject.util.invalidateAddressMeta();
                }
            };
        };

        /**
         * Handler for blur events on postal code field
         * Triggers address validation after timeout if configured
         * @param {Object} subscriber - The subscriber object that triggered the blur
         * @returns {Function} Event handler for blur events
         */
        ExtendableObject.cb.postalCodeBlur = function (subscriber) {
            return async (e) => {
                const isAnyActive = ExtendableObject._subscribers.postalCode.some(sub =>
                    document.activeElement === sub.object);

                if (!isAnyActive) {
                    // Reset values and remove dropdown
                    ExtendableObject.postalCodePredictions = [];
                    ExtendableObject._postalCodePredictionsIndex = PREDICTIONS_INDEX_DEFAULT;
                    ExtendableObject.util.removePostalCodePredictionsDropdown();
                }

                try {
                    await ExtendableObject.waitForPredictionApplication();
                    await ExtendableObject.waitUntilReady();
                    await ExtendableObject.cb.handleFormBlur();
                } catch (error) {
                    console.warn('Error in postalCodeBlur handler:', error);
                }
            };
        };

        /**
         * Handler for keyboard events on the postal code field
         * Manages keyboard navigation within the predictions dropdown
         * @returns {Function} Event handler that manages keyboard navigation and selection
         */
        ExtendableObject.cb.postalCodeKeydown = () => {
            return function (e) {
                if (e.key === 'ArrowUp' || e.key === 'Up') {
                    e.preventDefault();
                    e.stopPropagation();
                    if (ExtendableObject._postalCodePredictionsIndex > PREDICTIONS_INDEX_DEFAULT) {
                        ExtendableObject._postalCodePredictionsIndex = ExtendableObject._postalCodePredictionsIndex - 1;
                        ExtendableObject.util.renderPostalCodePredictionsDropdown(ExtendableObject._directionUp);
                    }
                    // Arrow up at no selection does nothing (stays at -1)
                } else if (e.key === 'ArrowDown' || e.key === 'Down') {
                    e.preventDefault();
                    e.stopPropagation();
                    if (ExtendableObject._postalCodePredictionsIndex < (ExtendableObject._postalCodePredictions.length - 1)) {
                        ExtendableObject._postalCodePredictionsIndex = ExtendableObject._postalCodePredictionsIndex + 1;
                    } else {
                        ExtendableObject._postalCodePredictionsIndex = 0;
                    }
                    ExtendableObject.util.renderPostalCodePredictionsDropdown(ExtendableObject._directionDown);
                } else if (e.key === 'Home') {
                    e.preventDefault();
                    e.stopPropagation();
                    ExtendableObject._postalCodePredictionsIndex = 0;
                    ExtendableObject.util.renderPostalCodePredictionsDropdown();
                } else if (e.key === 'End') {
                    e.preventDefault();
                    e.stopPropagation();
                    ExtendableObject._postalCodePredictionsIndex = ExtendableObject._postalCodePredictions.length - 1;
                    ExtendableObject.util.renderPostalCodePredictionsDropdown();
                } else if (e.key === 'Escape') {
                    if (ExtendableObject._postalCodePredictions.length) {
                        e.preventDefault();
                        e.stopPropagation();
                    }
                    ExtendableObject.resetPostalCodePredictions();
                    ExtendableObject.util.removePostalCodePredictionsDropdown();
                } else if (e.key === 'Tab') {
                    if (ExtendableObject._postalCodePredictions.length > 0 && ExtendableObject._postalCodePredictionsIndex >= 0) {
                        e.preventDefault();

                        (async () => {
                            await ExtendableObject.cb.applyPostalCodePredictionSelection(
                                ExtendableObject._postalCodePredictionsIndex,
                                ExtendableObject._postalCodePredictions
                            );
                            ExtendableObject.resetPostalCodePredictions();
                            ExtendableObject.util.removePostalCodePredictionsDropdown();

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
                    if (ExtendableObject._postalCodePredictions.length > 0 && ExtendableObject._postalCodePredictionsIndex >= 0) {
                        e.preventDefault();
                        e.stopImmediatePropagation();

                        (async () => {
                            await ExtendableObject.cb.applyPostalCodePredictionSelection(
                                ExtendableObject._postalCodePredictionsIndex,
                                ExtendableObject._postalCodePredictions
                            );
                            ExtendableObject.resetPostalCodePredictions();
                            ExtendableObject.util.removePostalCodePredictionsDropdown();
                        })();
                    } else {
                        ExtendableObject.util.removePostalCodePredictionsDropdown();
                    }
                } else if (e.key === 'Backspace' || e.key === 'Backspace') {
                    ExtendableObject.config.ux.smartFill = false;
                }
            };
        };

        /**
         * Applies the selected prediction to the form fields
         * Updates postal code, locality, and subdivision code as available
         * @param {number} index - Selected prediction index
         * @param {Array} predictions - Array of available predictions
         */
        ExtendableObject.cb.applyPostalCodePredictionSelection = async (index, predictions) => {
            const applicationPromise = (async () => {
                ExtendableObject._allowFetchPostalCodeAutocomplete = false;
                ExtendableObject._allowFetchLocalityAutocomplete = false;

                await ExtendableObject.setPostalCode(predictions[index].postalCode);

                if (predictions[index].locality && predictions[index].locality !== '') {
                    await ExtendableObject.setLocality(predictions[index].locality);
                }

                if (predictions[index].subdivisionCode && predictions[index].subdivisionCode !== '') {
                    await ExtendableObject.setSubdivisionCode(predictions[index].subdivisionCode);
                }

                ExtendableObject._allowFetchPostalCodeAutocomplete = true;
                ExtendableObject._allowFetchLocalityAutocomplete = true;
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
         * Resets postal code predictions state
         * Clears predictions array and resets selection index
         */
        ExtendableObject.resetPostalCodePredictions = () => {
            ExtendableObject.postalCodePredictions = [];
            ExtendableObject._postalCodePredictionsIndex = PREDICTIONS_INDEX_DEFAULT;
        };
    },

    /**
     * Registers utility functions for postal code functionality
     * @param {Object} ExtendableObject - The object to extend with utility methods
     */
    registerUtilities: (ExtendableObject) => {
        /**
         * Manages the display of autocomplete suggestions dropdown
         * Debounces API calls and renders results when available
         * @param {string} postalCode - Current postal code input value
         * @returns {Promise<void>}
         */
        ExtendableObject.util.displayPostalCodeAutocompleteDropdown = (postalCode) => {
            ExtendableObject.util.removePostalCodePredictionsDropdown();

            if (ExtendableObject._postalCodeAutocompleteTimeout) {
                clearTimeout(ExtendableObject._postalCodeAutocompleteTimeout);
            }

            ExtendableObject._postalCodeAutocompleteTimeout = setTimeout(async () => {
                ExtendableObject._postalCodeAutocompleteTimeout = null;
                try {
                    const autocompleteResult = await ExtendableObject.util.getPostalCodePredictions(postalCode);
                    const currentPostalCode = ExtendableObject.getPostalCode();

                    if (autocompleteResult.originalPostalCode !== currentPostalCode) {
                        return;
                    }

                    ExtendableObject._postalCodePredictionsIndex = PREDICTIONS_INDEX_DEFAULT;
                    await ExtendableObject.setPostalCodePredictions(autocompleteResult.predictions);
                    ExtendableObject.util.renderPostalCodePredictionsDropdown();
                } catch (err) {
                    console.warn('Failed fetching predictions', {
                        error: err,
                        postalCode
                    });
                }
            }, ExtendableObject.config.ux.delay.inputAssistant);
        };

        /**
         * Removes the predictions dropdown from the DOM
         * Cleans up any existing dropdown elements
         * @param {string} inputId - Optional input element ID to remove dropdown for specific input only
         */
        ExtendableObject.util.removePostalCodePredictionsDropdown = (inputId = '') => {
            let selector = '[endereco-postal-code-predictions]';

            // If inputId is provided, target specific dropdown
            if (inputId) {
                selector = `[endereco-postal-code-predictions][data-input-id="${inputId}"]`;
            }

            const dropdowns = inputId ? [document.querySelector(selector)] : document.querySelectorAll(selector);

            dropdowns.forEach(dropdown => {
                if (dropdown) {
                    dropdown.parentNode.removeChild(dropdown);
                    if (ExtendableObject._openDropdowns) {
                        ExtendableObject._openDropdowns--;
                    }
                }
            });
        };

        /**
         * Renders the predictions dropdown with diff highlighting
         * Handles dropdown positioning, diff highlighting, and event listeners
         */
        ExtendableObject.util.renderPostalCodePredictionsDropdown = (scrollDirection = null) => {
            const originalPostalCode = ExtendableObject.getPostalCode();
            const predictions = ExtendableObject.getPostalCodePredictions();

            // Save predictions container scroll state
            ExtendableObject.scrollState = null;
            if (
                scrollDirection === ExtendableObject._directionUp ||
                scrollDirection === ExtendableObject._directionDown
            ) {
                const currentActiveItem = document.querySelector(
                    '[endereco-postal-code-predictions] .endereco-predictions__item.active'
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
            ExtendableObject._subscribers.postalCode.forEach(function (subscriber) {
                // Ensure the input element has an ID for accessibility
                if (!subscriber.object.id) {
                    subscriber.object.id = ExtendableObject.util.generateUniqueId('endereco');
                }

                // Remove only the dropdown associated with this specific input
                ExtendableObject.util.removePostalCodePredictionsDropdown(subscriber.object.id);

                // Render predictions only if the field is active and there are predictions
                if (predictions.length > 0 && document.activeElement === subscriber.object) {
                    let startingIndex = 0;
                    const preparedPredictions = [];

                    // Prepare predictions
                    predictions.forEach(function (prediction) {
                        const diff = diffChars(originalPostalCode, prediction.postalCode, { ignoreCase: true });
                        let postalCodeHtml = '';

                        diff.forEach(function (part) {
                            const markClass = part.added
                                ? 'endereco-span--add'
                                : part.removed ? 'endereco-span--remove' : 'endereco-span--neutral';

                            // Security fix: Escape HTML entities before building HTML string
                            const escapedValue = ExtendableObject.util.escapeHTML(part.value);

                            postalCodeHtml += `<span class="${markClass}">${escapedValue}</span>`;
                        });

                        const tempData = {
                            postalCode: prediction.postalCode,
                            locality: prediction.locality,
                            postalCodeDiff: postalCodeHtml
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
                                    tempData.subdivisionName = '';
                                }
                            }
                        }

                        preparedPredictions.push(tempData);
                    });

                    // Prepare dropdown
                    const predictionsHtml = ExtendableObject.util.Mustache.render(ExtendableObject.config.templates.postalCodePredictions, {
                        ExtendableObject,
                        predictions: preparedPredictions,
                        inputId: subscriber.object.id,
                        offsetTop: subscriber.object.offsetTop + subscriber.object.offsetHeight,
                        offsetLeft: subscriber.object.offsetLeft,
                        width: subscriber.object.offsetWidth,
                        direction: getComputedStyle(subscriber.object).direction,
                        longList: (preparedPredictions.length > MAX_PREDICTIONS_BEFORE_SCROLL),
                        index: function () {
                            return (startingIndex - 1);
                        },
                        isActive: function () {
                            const isActive = (startingIndex === ExtendableObject._postalCodePredictionsIndex);

                            startingIndex++;

                            return isActive;
                        }
                    });

                    // Attach it to HTML
                    subscriber.object.insertAdjacentHTML('afterend', predictionsHtml);
                    if (ExtendableObject._openDropdowns !== undefined) {
                        ExtendableObject._openDropdowns++;
                    }

                    // Scroll active item into view
                    setTimeout(() => {
                        const activeItem = document.querySelector('[endereco-postal-code-predictions] .endereco-predictions__item.active');

                        if (ExtendableObject._postalCodePredictionsIndex === 0) {
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

                    document.querySelectorAll(`[data-id="${ExtendableObject.id}"] [endereco-postal-code-prediction]`).forEach((DOMElement) => {
                        DOMElement.addEventListener('mousedown', (e) => {
                            const index = parseInt(DOMElement.getAttribute('data-prediction-index'));

                            e.preventDefault();
                            e.stopPropagation();

                            ExtendableObject.cb.applyPostalCodePredictionSelection(
                                index,
                                predictions
                            );

                            ExtendableObject.postalCodePredictions = [];
                            ExtendableObject.util.removePostalCodePredictionsDropdown();
                        });
                    });
                }
            });
        };
    },

    /**
     * Registers API interaction handlers for postal code data
     * @param {Object} ExtendableObject - The object to extend with API handlers
     */
    registerAPIHandlers: (ExtendableObject) => {
        /**
         * Fetches postal code predictions from the Endereco API
         * Handles caching, request formation, and response processing
         *
         * @param {string} postalCodeRaw - Raw postal code input to get predictions for
         * @returns {Promise<Object>} Prediction results with original input
         * @throws {Error} If input is invalid or API request fails
         */
        ExtendableObject.util.getPostalCodePredictions = async function (postalCodeRaw) {
            if (typeof postalCodeRaw !== 'string') {
                throw new Error('Invalid argument. The postalCodeRaw has to be a string');
            }

            const postalCode = postalCodeRaw.trim();
            const autocompleteResult = {
                originalPostalCode: postalCode,
                predictions: []
            };

            // Early return
            if (postalCode === '') {
                return autocompleteResult;
            }

            const cacheKeyData = [
                ExtendableObject.countryCode,
                ExtendableObject.config.lang,
                postalCode,
                ExtendableObject.locality,
                ExtendableObject.streetName,
                ExtendableObject.buildingNumber
            ];

            if (ExtendableObject.util.hasSubscribedField('subdivisionCode')) {
                cacheKeyData.push(ExtendableObject.getSubdivisionCode());
            }

            const cacheKey = cacheKeyData.join('-');

            if (!ExtendableObject.postalCodeAutocompleteCache.cachedResults[cacheKey]) {
                const autocompleteRequestIndex = ++ExtendableObject._postalCodeAutocompleteRequestIndex;

                const message = {
                    jsonrpc: '2.0',
                    id: autocompleteRequestIndex,
                    method: 'postCodeAutocomplete',
                    params: {
                        country: ExtendableObject.countryCode,
                        language: ExtendableObject.config.lang,
                        postCode: postalCode,
                        cityName: ExtendableObject.locality,
                        street: ExtendableObject.streetName,
                        houseNumber: ExtendableObject.buildingNumber
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

                const postalCodePredictionsTemp = [];

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

                // If session counter is set, increase it
                if (ExtendableObject.hasLoadedExtension('SessionExtension')) {
                    ExtendableObject.sessionCounter++;
                }

                let counter = 0;

                result.data.result.predictions.forEach((postalCodePrediction) => {
                    if (!postalCodePrediction || counter >= MAX_AUTOCOMPLETE_PREDICTIONS) {
                        return;
                    }
                    counter++;

                    const tempPostalCodeContainer = {
                        countryCode: postalCodePrediction.country || ExtendableObject._countryCode,
                        postalCode: postalCodePrediction.postCode || '',
                        locality: postalCodePrediction.cityName || ''
                    };

                    // Fix around API
                    if (postalCodePrediction.subdivisionCode &&
                            ExtendableObject.util.hasSubscribedField('subdivisionCode')
                    ) {
                        tempPostalCodeContainer.subdivisionCode = postalCodePrediction.subdivisionCode;
                    }

                    postalCodePredictionsTemp.push(tempPostalCodeContainer);
                });

                ExtendableObject.postalCodeAutocompleteCache.cachedResults[cacheKey] = postalCodePredictionsTemp;
            }

            autocompleteResult.predictions = ExtendableObject.postalCodeAutocompleteCache.cachedResults[cacheKey];

            return autocompleteResult;
        };
    },

    /**
     * Registers filter callbacks that process postal code data
     * @param {Object} ExtendableObject - The object to extend with filter callbacks
     */
    registerFilterCallbacks: (ExtendableObject) => {
        /**
         * Filter callback for postal code value processing
         * @param {string} postalCode - The postal code value to process
         * @returns {string} The processed postal code value
         */
        ExtendableObject.cb.setPostalCode = (postalCode) => postalCode;

        /**
         * Filter callback for postal code predictions processing
         * @param {Array} postalCodePredictions - The predictions array to process
         * @returns {Array} The processed predictions array
         */
        ExtendableObject.cb.setPostalCodePredictions = (postalCodePredictions) => postalCodePredictions;
    },

    /**
     * Main extension method that applies all postal code functionality to the object
     * @param {Object} ExtendableObject - The object to extend with postal code functionality
     * @returns {Promise<Object>} The PostalCodeExtension object
     */
    extend: async (ExtendableObject) => {
        await PostalCodeExtension.registerProperties(ExtendableObject);
        await PostalCodeExtension.registerFields(ExtendableObject);
        await PostalCodeExtension.registerConfig(ExtendableObject);
        await PostalCodeExtension.registerEventCallbacks(ExtendableObject);
        await PostalCodeExtension.registerUtilities(ExtendableObject);
        await PostalCodeExtension.registerAPIHandlers(ExtendableObject);
        await PostalCodeExtension.registerFilterCallbacks(ExtendableObject);

        return PostalCodeExtension;
    }
};

export default PostalCodeExtension;

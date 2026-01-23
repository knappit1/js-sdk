/**
 * Extends the base object with "streetFull" field handling capabilities.
 * Adds support for single-line street input ("streetFull") by:
 * - Adding streetFull property with getter/setter
 * - Parsing it into separate street name and building number components
 * - Providing autocomplete suggestions for the full street input
 * - Syncing parsed components with separate streetName/buildingNumber fields if present
 * - Caching API parsing results for performance
 * - Handling keyboard navigation for autocomplete suggestions
 */

import { diffChars } from 'diff';
import streetFullPredictionsTemplate from '../../../templates/street_full_predictions.html';
import streetFullTemplateFactory from '../../../templates/streetNameTemplates';

const MAX_PREDICTIONS_BEFORE_SCROLL = 6;
const ERROR_EXPIRED_SESSION = -32700;

/**
 * Default predictions index value (no selection)
 * @type {number}
 */
const PREDICTIONS_INDEX_DEFAULT = -1;

const StreetFullExtension = {
    name: 'StreetFullExtension',

    /**
     * Place for registering internal properties needed for streetFull functionality.
     * Add here:
     * - Internal storage fields (_fieldName)
     * - Subscriber arrays (_subscribers.fieldName)
     * - Cache objects
     * - Control flags
     * - Timeout and sequence tracking variables
     * @param {Object} ExtendableObject - The base object being extended
     */
    registerProperties: (ExtendableObject) => {
        // Internal storage for field values
        ExtendableObject._streetFull = '';
        ExtendableObject._streetFullPredictions = [];

        // Subscriber storage
        ExtendableObject._subscribers.streetFull = [];

        // Cache
        ExtendableObject.streetSplitCache = {
            cachedResults: {}
        };
        ExtendableObject.streetFullAutocompleteCache = {
            cachedResults: {}
        };

        // Flags
        ExtendableObject._allowToNotifyStreetFullSubscribers = true;
        ExtendableObject._allowStreetFullSplit = true;
        ExtendableObject._allowStreetFullCompose = true;
        ExtendableObject._allowFetchStreetFullAutocomplete = false;

        // Timeout and sequence
        ExtendableObject._streetFullAutocompleteTimeout = null;
        ExtendableObject._streetFullAutocompleteRequestIndex = 0;
        ExtendableObject._streetFullSplitTimeout = null;
        ExtendableObject._streetFullSplitRequestIndex = 0;
        ExtendableObject._streetFullPredictionsIndex = PREDICTIONS_INDEX_DEFAULT;

        ExtendableObject._directionUp = 'up';
        ExtendableObject._directionDown = 'down';
    },

    /**
     * Place for registering fields that should be exposed on the ExtendableObject.
     * Add here:
     * - Public properties with getters/setters
     * - Field tracking registration
     * - Property change handling logic
     * @param {Object} ExtendableObject - The base object being extended
     */
    registerFields: (ExtendableObject) => {
        // Add getter and setter for fields.
        Object.defineProperty(ExtendableObject, 'streetFull', {
            get: () => {
                return ExtendableObject.getStreetFull();
            },
            set: async (value) => {
                await ExtendableObject.setStreetFull(value);
            }
        });

        ExtendableObject.getStreetFull = () => {
            return ExtendableObject._streetFull;
        };

        ExtendableObject.setStreetFull = async (streetFull) => {
            const needToNotify = ExtendableObject.active && ExtendableObject._allowToNotifyStreetFullSubscribers;
            const needToDisplayAutocompleteDropdown = ExtendableObject.active &&
                ExtendableObject.config.useAutocomplete &&
                ExtendableObject._allowFetchStreetFullAutocomplete;
            const needToSplit = ExtendableObject.active && ExtendableObject._allowStreetFullSplit;

            ExtendableObject._awaits++;

            try {
                let resolvedValue = await ExtendableObject.util.Promise.resolve(streetFull);

                resolvedValue = await ExtendableObject.cb.setStreetFull(resolvedValue);

                // Early return.
                if (resolvedValue === ExtendableObject._streetFull) {
                    return;
                }

                ExtendableObject._streetFull = resolvedValue;

                if (needToNotify) {
                    // Inform all subscribers about the change.
                    const notificationProcesses = [];

                    ExtendableObject._subscribers.streetFull.forEach((subscriber) => {
                        notificationProcesses.push(subscriber.updateDOMValue(resolvedValue));
                    });
                    await Promise.all(notificationProcesses);
                }

                if (needToSplit) {
                    await ExtendableObject.util.ensureStreetPartsIntegrity(resolvedValue);
                }

                if (needToDisplayAutocompleteDropdown) {
                    // eslint-disable-next-line no-unused-vars
                    const _ = ExtendableObject.util.displayStreetFullAutocompleteDropdown(resolvedValue);
                }
            } catch (e) {
                console.warn("Error while setting the field 'streetFull'", e);
            } finally {
                ExtendableObject._awaits--;
            }
        };
        ExtendableObject.fieldNames.push('streetFull'); // TODO: check if still needed

        Object.defineProperty(ExtendableObject, 'streetFullPredictions', {
            get: () => {
                return ExtendableObject.getStreetFullPredictions();
            },
            set: async (value) => {
                await ExtendableObject.setStreetFullPredictions(value);
            }
        });

        ExtendableObject.getStreetFullPredictions = () => {
            return ExtendableObject._streetFullPredictions;
        };

        ExtendableObject.setStreetFullPredictions = async (streetFullPredictions) => {
            const resolvedValue = await ExtendableObject.util.Promise.resolve(streetFullPredictions);

            if (ExtendableObject.streetFullPredictions !== resolvedValue) {
                ExtendableObject._streetFullPredictions = resolvedValue;
            }
        };
    },

    /**
     * Place for registering event-related callback functions.
     * Add here:
     * - DOM event handlers (onChange, onInput, onBlur, etc.)
     * - Keyboard interaction handlers
     * - Event propagation control
     * - Event-triggered state updates
     * @param {Object} ExtendableObject - The base object being extended
     */
    registerEventCallbacks: (ExtendableObject) => {
        /**
         * Handler for field value changes via normal input events (without the field being in focus)
         * @param {Object} subscriber - The subscriber object that triggered the change
         * @returns {Function} Event handler that updates streetFull while preventing circular updates
         */
        ExtendableObject.cb.streetFullChange = (subscriber) => {
            return () => {
                ExtendableObject._allowToNotifyStreetFullSubscribers = false;
                ExtendableObject._allowFetchStreetFullAutocomplete = false;
                ExtendableObject.streetFull = subscriber.value;
                ExtendableObject._allowToNotifyStreetFullSubscribers = true;

                if (ExtendableObject.active) {
                    ExtendableObject.util.invalidateAddressMeta();
                }
            };
        };

        /**
         * Handler for field value changes via direct input events (while being in focus)
         * @param {Object} subscriber - The subscriber object that triggered the input
         * @returns {Function} Event handler that updates streetFull while preventing circular updates
         */
        ExtendableObject.cb.streetFullInput = (subscriber) => {
            return () => {
                ExtendableObject._allowToNotifyStreetFullSubscribers = false;
                ExtendableObject._allowFetchStreetFullAutocomplete = true;
                ExtendableObject.streetFull = subscriber.value;
                ExtendableObject._allowToNotifyStreetFullSubscribers = true;
                ExtendableObject._allowFetchStreetFullAutocomplete = false;

                if (ExtendableObject.active) {
                    ExtendableObject.util.invalidateAddressMeta();
                }
            };
        };

        /**
         * Handler for field blur events (field focus and de-focus)
         * @returns {Function} Event handler that manages validation and dropdown cleanup
         */
        ExtendableObject.cb.streetFullBlur = () => {
            return async () => {
                // Handle dropdown cleanup
                const isAnyActive = ExtendableObject._subscribers.streetFull.some(
                    sub => document.activeElement === sub.object
                );

                if (!isAnyActive) {
                    ExtendableObject.streetFullPredictions = [];
                    ExtendableObject._streetFullPredictionsIndex = PREDICTIONS_INDEX_DEFAULT;
                    ExtendableObject.util.removeStreetFullPredictionsDropdown();
                }

                try {
                    await ExtendableObject.waitForPredictionApplication();
                    await ExtendableObject.waitUntilReady();
                    await ExtendableObject.cb.handleFormBlur();
                } catch (error) {
                    console.warn('Error in streetFullBlur handler:', error);
                }
            };
        };

        /**
         * Handler for keyboard events on the streetFull field
         * @returns {Function} Event handler that manages keyboard navigation and selection
         */
        ExtendableObject.cb.streetFullKeydown = () => {
            return function (e) {
                if (e.key === 'ArrowUp' || e.key === 'Up') {
                    e.preventDefault();
                    e.stopPropagation();
                    if (ExtendableObject._streetFullPredictionsIndex > PREDICTIONS_INDEX_DEFAULT) {
                        ExtendableObject._streetFullPredictionsIndex = ExtendableObject._streetFullPredictionsIndex - 1;
                        ExtendableObject.util.renderStreetFullPredictionsDropdown(
                            ExtendableObject.streetFullPredictions,
                            ExtendableObject._directionUp
                        );
                    }
                    // Arrow up at no selection does nothing (stays at -1)
                } else if (e.key === 'ArrowDown' || e.key === 'Down') {
                    e.preventDefault();
                    e.stopPropagation();
                    if (ExtendableObject._streetFullPredictionsIndex < (ExtendableObject._streetFullPredictions.length - 1)) {
                        ExtendableObject._streetFullPredictionsIndex = ExtendableObject._streetFullPredictionsIndex + 1;
                    } else {
                        ExtendableObject._streetFullPredictionsIndex = 0;
                    }
                    ExtendableObject.util.renderStreetFullPredictionsDropdown(
                        ExtendableObject.streetFullPredictions,
                        ExtendableObject._directionDown
                    );
                } else if (e.key === 'Home') {
                    e.preventDefault();
                    e.stopPropagation();
                    ExtendableObject._streetFullPredictionsIndex = 0;
                    ExtendableObject.util.renderStreetFullPredictionsDropdown(
                        ExtendableObject.streetFullPredictions
                    );
                } else if (e.key === 'End') {
                    e.preventDefault();
                    e.stopPropagation();
                    ExtendableObject._streetFullPredictionsIndex = ExtendableObject._streetFullPredictions.length - 1;
                    ExtendableObject.util.renderStreetFullPredictionsDropdown(
                        ExtendableObject.streetFullPredictions
                    );
                } else if (e.key === 'Escape') {
                    if (ExtendableObject._streetFullPredictions.length) {
                        e.preventDefault();
                        e.stopPropagation();
                    }
                    ExtendableObject.resetStreetFullPredictions();
                    ExtendableObject.util.removeStreetFullPredictionsDropdown();
                } else if (e.key === 'Tab') {
                    if (ExtendableObject._streetFullPredictions.length > 0 && ExtendableObject._streetFullPredictionsIndex >= 0) {
                        e.preventDefault();

                        (async () => {
                            await ExtendableObject.cb.applyStreetFullPredictionSelection(
                                ExtendableObject._streetFullPredictionsIndex,
                                ExtendableObject._streetFullPredictions
                            );
                            ExtendableObject.resetStreetFullPredictions();
                            ExtendableObject.util.removeStreetFullPredictionsDropdown();

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
                    if (ExtendableObject._streetFullPredictions.length > 0 && ExtendableObject._streetFullPredictionsIndex >= 0) {
                        e.preventDefault();
                        e.stopImmediatePropagation();

                        (async () => {
                            await ExtendableObject.cb.applyStreetFullPredictionSelection(
                                ExtendableObject._streetFullPredictionsIndex,
                                ExtendableObject._streetFullPredictions
                            );
                            ExtendableObject.resetStreetFullPredictions();
                            ExtendableObject.util.removeStreetFullPredictionsDropdown();
                        })();
                    }
                } else if (e.key === 'Backspace' || e.key === 'Backspace') {
                    ExtendableObject.config.ux.smartFill = false;
                }
            };
        };

        /**
         * Applies the selected street full prediction to the field
         * @param {number} index - Selected prediction index
         * @param {Array} predictions - Array of available predictions
         */
        ExtendableObject.cb.applyStreetFullPredictionSelection = async (index, predictions) => {
            const applicationPromise = (async () => {
                ExtendableObject._allowFetchStreetFullAutocomplete = false;
                await ExtendableObject.setStreetFull(predictions[index].streetFull);
                ExtendableObject._allowFetchStreetFullAutocomplete = true;
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
         * Resets street full predictions state
         * Clears predictions array and resets selection index
         */
        ExtendableObject.resetStreetFullPredictions = () => {
            ExtendableObject.streetFullPredictions = [];
            ExtendableObject._streetFullPredictionsIndex = PREDICTIONS_INDEX_DEFAULT;
        };
    },

    /**
     * Place for registering utility functions used across the extended object.
     * Add here:
     * - UI manipulation functions
     * - Data processing helpers
     * - State management utilities
     * - Formatting functions
     * @param {Object} ExtendableObject - The base object being extended
     */
    registerUtilities: (ExtendableObject) => {
        /**
         * Manages the display of autocomplete suggestions dropdown
         * @param {string} streetFull - Current street input value
         * @returns {Promise<void>}
         */
        ExtendableObject.util.displayStreetFullAutocompleteDropdown = (streetFull) => {
            ExtendableObject.util.removeStreetFullPredictionsDropdown();

            if (ExtendableObject._streetFullAutocompleteTimeout) {
                clearTimeout(ExtendableObject._streetFullAutocompleteTimeout);
            }

            ExtendableObject._streetFullAutocompleteTimeout = setTimeout(async () => {
                ExtendableObject._streetFullAutocompleteTimeout = null;
                try {
                    const autocompleteResult = await ExtendableObject.util.getStreetFullPredictions(streetFull);
                    const getCurrentStreetFull = ExtendableObject.getStreetFull();

                    if (autocompleteResult.originalStreetFull !== getCurrentStreetFull) {
                        return;
                    }

                    ExtendableObject._streetFullPredictionsIndex = PREDICTIONS_INDEX_DEFAULT;
                    ExtendableObject.streetFullPredictions = autocompleteResult.predictions;
                    ExtendableObject.util.renderStreetFullPredictionsDropdown(autocompleteResult.predictions);
                } catch (e) {
                    console.warn('Failed fetching predictions', e, streetFull);
                }
            }, ExtendableObject.config.ux.delay.inputAssistant);
        };

        /**
         * Removes the predictions dropdown from the DOM
         * Updates the dropdown counter and cleans up related state
         */
        /**
         * Removes the predictions dropdown from the DOM
         * Cleans up any existing dropdown elements
         * @param {string} inputId - Optional input element ID to remove dropdown for specific input only
         */
        ExtendableObject.util.removeStreetFullPredictionsDropdown = (inputId = '') => {
            let selector = '[endereco-street-full-predictions]';

            // If inputId is provided, target specific dropdown
            if (inputId) {
                selector = `[endereco-street-full-predictions][data-input-id="${inputId}"]`;
            }

            const dropdowns = inputId ? [document.querySelector(selector)] : document.querySelectorAll(selector);

            dropdowns.forEach(dropdown => {
                if (dropdown) {
                    ExtendableObject._openDropdowns--;
                    dropdown.parentNode.removeChild(dropdown);
                }
            });
        };

        /**
         * Renders the predictions dropdown with diff highlighting
         * @param {Array} predictions - Array of address predictions
         * Handles:
         * - Dropdown positioning
         * - Diff highlighting
         * - Event listeners for selection
         */
        ExtendableObject.util.renderStreetFullPredictionsDropdown = function (predictions, scrollDirection = null) {
            predictions = JSON.parse(JSON.stringify(predictions)); // Create a copy

            // Save predictions container scroll state
            ExtendableObject.scrollState = null;
            if (
                scrollDirection === ExtendableObject._directionUp ||
                scrollDirection === ExtendableObject._directionDown
            ) {
                const currentActiveItem = document.querySelector(
                    '[endereco-street-full-predictions] .endereco-predictions__item.active'
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

            // Render dropdown under the input element
            ExtendableObject._subscribers.streetFull.forEach(function (subscriber) {
                // Ensure the input element has an ID for accessibility
                if (!subscriber.object.id) {
                    subscriber.object.id = ExtendableObject.util.generateUniqueId('endereco');
                }

                // Remove only the dropdown associated with this specific input
                ExtendableObject.util.removeStreetFullPredictionsDropdown(subscriber.object.id);

                // Render predictions only if the field is active and there are predictions.
                if (
                    predictions.length > 0 &&
                    (document.activeElement === subscriber.object)
                ) {
                    let startingIndex = 0;
                    const preparedPredictions = [];

                    // Prepare predictions.
                    predictions.forEach(function (prediction) {
                        const diff = diffChars(ExtendableObject.streetFull, prediction.streetFull, { ignoreCase: true });
                        let streetFullHtml = '';

                        diff.forEach(function (part) {
                            const markClass = part.added
                                ? 'endereco-span--add'
                                : part.removed ? 'endereco-span--remove' : 'endereco-span--neutral';

                            // Security fix: Escape HTML entities before building HTML string
                            const escapedValue = ExtendableObject.util.escapeHTML(part.value);

                            streetFullHtml += `<span class="${markClass}">${escapedValue}</span>`;
                        });

                        preparedPredictions.push({
                            streetFull: prediction.streetFull,
                            streetFullDiff: streetFullHtml
                        });
                    });

                    // Prepare dropdown.
                    const predictionsHtml = ExtendableObject.util.Mustache.render(ExtendableObject.config.templates.streetFullPredictions, {
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
                            const isActive = (startingIndex === ExtendableObject._streetFullPredictionsIndex);

                            startingIndex++;

                            return isActive;
                        }
                    });

                    // Attach it to HTML.
                    subscriber.object.insertAdjacentHTML('afterend', predictionsHtml);
                    ExtendableObject._openDropdowns++;

                    // Scroll active item into view
                    setTimeout(() => {
                        const activeItem = document.querySelector('[endereco-street-full-predictions] .endereco-predictions__item.active');

                        if (ExtendableObject._streetFullPredictionsIndex === 0) {
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

                    document.querySelectorAll(`[data-id="${ExtendableObject.id}"] [endereco-street-full-prediction]`).forEach(function (DOMElement) {
                        DOMElement.addEventListener('mousedown', function (e) {
                            const index = parseInt(this.getAttribute('data-prediction-index'));

                            e.preventDefault();
                            e.stopPropagation();
                            ExtendableObject._allowFetchStreetFullAutocomplete = false;
                            ExtendableObject.streetFull = predictions[index].streetFull;
                            ExtendableObject.streetFullPredictions = [];
                            ExtendableObject._allowFetchStreetFullAutocomplete = true;
                            ExtendableObject.util.removeStreetFullPredictionsDropdown();
                        });
                    });
                }
            });
        };

        /**
         * Ensures street name and number are properly split and synchronized
         * Can operate in either synchronous (immediate await) or asynchronous (debounced) mode
         * @param {string} streetFull - Combined street input to split
         * @returns {Promise<void|Object>} - Returns void in async mode, split data in sync mode
         */
        ExtendableObject.util.ensureStreetPartsIntegrity = (streetFull) => {
            // Based on internal flag, choose appropriate execution mode
            if (ExtendableObject._isIntegrityOperationSynchronous) {
                return ExtendableObject.util.ensureStreetPartsIntegrityAsync(streetFull);
            } else {
                ExtendableObject.util.ensureStreetPartsIntegrityWithDebounce(streetFull);
            }
        };

        /**
         * Ensures street parts integrity with debouncing (original behavior)
         * @param {string} streetFull - Combined street input to split
         */
        ExtendableObject.util.ensureStreetPartsIntegrityWithDebounce = (streetFull) => {
            if (ExtendableObject._streetFullSplitTimeout) {
                clearTimeout(ExtendableObject._streetFullSplitTimeout);
            }

            ExtendableObject._streetFullSplitTimeout = setTimeout(async () => {
                try {
                    const { streetName, buildingNumber } = await ExtendableObject.util.splitStreet(streetFull);

                    // Check if splitStreet result is outdated
                    if (ExtendableObject.streetFull !== streetFull) {
                        return;
                    }

                    ExtendableObject._allowStreetFullCompose = false;
                    ExtendableObject._allowFetchStreetNameAutocomplete = false;
                    ExtendableObject.streetName = streetName;
                    ExtendableObject.buildingNumber = buildingNumber;
                    ExtendableObject._allowStreetFullCompose = true;
                    ExtendableObject._allowFetchStreetNameAutocomplete = true;
                } catch (e) {
                    console.warn('Street split failed', e, streetFull);
                }
                ExtendableObject._streetFullSplitTimeout = null;
            }, ExtendableObject.config.ux.delay.inputAssistant);
        };

        /**
         * Ensures street parts integrity synchronously (immediate execution)
         * @param {string} streetFull - Combined street input to split
         * @returns {Promise<Object>} Split address components
         */
        ExtendableObject.util.ensureStreetPartsIntegrityAsync = async function (streetFull) {
            try {
                const splitResult = await ExtendableObject.util.splitStreet(streetFull);

                // Check if splitStreet result is outdated
                if (ExtendableObject.streetFull !== streetFull) {
                    return null;
                }

                ExtendableObject._allowStreetFullCompose = false;
                ExtendableObject._allowFetchStreetNameAutocomplete = false;
                ExtendableObject.streetName = splitResult.streetName;
                ExtendableObject.buildingNumber = splitResult.buildingNumber;
                ExtendableObject._allowStreetFullCompose = true;
                ExtendableObject._allowFetchStreetNameAutocomplete = true;

                return splitResult;
            } catch (e) {
                console.warn('Synchronous street split failed', e, streetFull);

                return null;
            }
        };

        /**
         * Formats street components according to country-specific template
         * @param {Object} [streetData] - Optional street data object
         * @param {string} [streetData.countryCode] - Country code for formatting
         * @param {string} [streetData.streetName] - Street name
         * @param {string} [streetData.buildingNumber] - Building number
         * @param {string} [streetData.additionalInfo] - Additional address info
         * @returns {string} Formatted street address
         */
        ExtendableObject.util.formatStreetFull = function (streetData = null) {
            const $self = ExtendableObject;

            if (streetData === null) {
                streetData = {
                    countryCode: $self.countryCode,
                    streetName: $self.streetName,
                    buildingNumber: $self.buildingNumber,
                    additionalInfo: $self.additionalInfo
                };
            }

            return $self.util.Mustache.render(
                $self.config.templates.streetFull.getTemplate(streetData.countryCode),
                streetData
            ).replace(/  +/g, ' ').replace(/(\r\n|\n|\r)/gm, '').trim();
        };
    },

    /**
     * Place for registering API communication functions.
     * Add here:
     * - API request functions
     * - Response handling
     * - Error management
     * - Caching logic
     * @param {Object} ExtendableObject - The base object being extended
     */
    registerAPIHandlers: (ExtendableObject) => {
        /**
         * Splits a combined street address into components via API
         * @param {string} streetFullRaw - Raw street input to split
         * @returns {Promise<Object>} Split address components
         * @throws {Error} If input is invalid or API request fails
         */
        ExtendableObject.util.splitStreet = async function (streetFullRaw) {
            if (typeof streetFullRaw !== 'string') {
                throw new Error('Invalid arguments. The streetFull has to be string');
            }

            if (!streetFullRaw.trim()) {
                return { streetName: '', streetFull: '', buildingNumber: '' };
            }

            const streetFull = streetFullRaw.trim(); // Create copy:
            const cacheKey = [
                ExtendableObject.countryCode || 'DE',
                ExtendableObject.config.lang,
                streetFull
            ].join('-');

            if (!ExtendableObject.streetSplitCache.cachedResults[cacheKey]) {
                ExtendableObject._awaits++;

                const streetFullSplitRequestIndex = ++ExtendableObject._streetFullSplitRequestIndex;

                const splitStreetRequest = {
                    jsonrpc: '2.0',
                    id: streetFullSplitRequestIndex,
                    method: 'splitStreet',
                    params: {
                        formatCountry: ExtendableObject.countryCode || 'DE',
                        language: ExtendableObject.config.lang,
                        street: streetFull
                    }
                };

                if (ExtendableObject._subscribers.additionalInfo.length > 0) {
                    for (const listener of ExtendableObject._subscribers.additionalInfo) {
                        if (!listener.object.disabled && listener.object.isConnected) {
                            splitStreetRequest.params.additionalInfo = ExtendableObject.address.additionalInfo;
                            break;
                        }
                    }
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

                try {
                    const EnderecoAPI = ExtendableObject.getEnderecoAPI();

                    const result = await EnderecoAPI.sendRequestToAPI(
                        splitStreetRequest,
                        headers
                    );

                    // Ensure that result exists.
                    if (!result?.data?.result) {
                        throw new Error("Invalid API response: Missing 'result' field in response data");
                    }

                    // Save in cache
                    ExtendableObject.streetSplitCache.cachedResults[cacheKey] = result.data.result;
                } catch (e) {
                    console.warn('Error splitting street full', e, streetFull);
                } finally {
                    ExtendableObject._awaits--;
                }
            }

            const result = ExtendableObject.streetSplitCache.cachedResults[cacheKey];
            const splitData = {
                originalStreetFull: streetFull, // Used to invalidate outdated splits downstream
                streetName: result.streetName || '',
                streetFull: result.street || '',
                buildingNumber: result.houseNumber || ''
            };

            if (result.additionalInfo !== undefined) {
                splitData.additionalInfo = result.additionalInfo ?? '';
            }

            return splitData;
        };

        /**
         * Fetches street predictions (including buildingNumber) from API
         * @param {string} streetFullRaw - Raw street input to get predictions for
         * @returns {Promise<Object>} Prediction results with original input
         * @throws {Error} If input is invalid or API request fails
         */
        ExtendableObject.util.getStreetFullPredictions = async function (streetFullRaw) {
            if (typeof streetFullRaw !== 'string') {
                throw new Error('Invalid argument. The streetFullRaw has to be a string');
            }

            const streetFull = streetFullRaw.trim();
            const autocompleteResult = {
                originalStreetFull: streetFull,
                predictions: []
            };

            // Early return
            if (streetFull === '') {
                return autocompleteResult;
            }

            const cacheKey = [
                ExtendableObject.countryCode,
                ExtendableObject.config.lang,
                ExtendableObject.postalCode,
                ExtendableObject.locality,
                streetFull
            ].join('-');

            if (!ExtendableObject.streetFullAutocompleteCache.cachedResults[cacheKey]) {
                const autocompleteRequestIndex = ++ExtendableObject._streetFullAutocompleteRequestIndex;

                const message = {
                    jsonrpc: '2.0',
                    id: autocompleteRequestIndex,
                    method: 'streetAutocomplete',
                    params: {
                        country: ExtendableObject.countryCode,
                        language: ExtendableObject.config.lang,
                        postCode: ExtendableObject.postalCode,
                        cityName: ExtendableObject.locality,
                        streetFull
                    }
                };

                const headers = {
                    'X-Auth-Key': ExtendableObject.config.apiKey,
                    'X-Agent': ExtendableObject.config.agentName,
                    'X-Remote-Api-Url': ExtendableObject.config.remoteApiUrl,
                    'X-Transaction-Referer': window.location.href,
                    'X-Transaction-Id': ExtendableObject.hasLoadedExtension?.('SessionExtension')
                        ? ExtendableObject.sessionId
                        : 'not_required'
                };

                const streetFullPredictionsTemp = [];

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

                result.data.result.predictions.forEach((streetFullPrediction) => {
                    if (!streetFullPrediction) return;

                    const { country, street, buildingNumber, additionalInfo } = streetFullPrediction || {};

                    const tempStreetFullContainer = {
                        countryCode: country ?? ExtendableObject._countryCode,
                        streetName: street ?? '',
                        buildingNumber: buildingNumber ?? '',
                        additionalInfo: additionalInfo ?? ''
                    };

                    if (streetFullPrediction.streetFull === undefined) {
                        tempStreetFullContainer.streetFull = ExtendableObject.util.Mustache.render(
                            streetFullTemplateFactory.getTemplate(tempStreetFullContainer.countryCode),
                            {
                                streetName: tempStreetFullContainer.streetName,
                                buildingNumber: tempStreetFullContainer.buildingNumber,
                                additionalInfo: tempStreetFullContainer.additionalInfo
                            }
                        )
                            .replace(/(\r\n|\n|\r)/gm, '')
                            .trim();
                    }

                    streetFullPredictionsTemp.push(tempStreetFullContainer);
                });

                ExtendableObject.streetFullAutocompleteCache.cachedResults[cacheKey] = streetFullPredictionsTemp;
            }

            autocompleteResult.predictions = ExtendableObject.streetFullAutocompleteCache.cachedResults[cacheKey];

            return autocompleteResult;
        };
    },

    /**
     * Place for registering data transformation and validation functions.
     * Add here:
     * - Input filters
     * - Data validators
     * - Value transformers
     * - Custom formatters
     * @param {Object} ExtendableObject - The base object being extended
     */
    registerFilterCallbacks: (ExtendableObject) => {
        /**
         * Filter function for streetFull value processing. Its not doing much, but it can be rewritten by
         * user implementation.
         * @param {string} streetFull - Street value to process
         * @returns {string} Processed street value
         */
        ExtendableObject.cb.setStreetFull = (streetFull) => streetFull;
    },

    /**
     * Place for registering configuration.
     * Add here:
     * - HTML templates
     * - UI configuration
     * - Display format templates
     * - Other configs
     * @param {Object} ExtendableObject - The base object being extended
     */
    registerConfig: (ExtendableObject) => {
        // Templates
        ExtendableObject.config.templates.streetFull = streetFullTemplateFactory;
        ExtendableObject.config.templates.streetFullPredictions = streetFullPredictionsTemplate;
    },

    /**
     * Main extension function that sets up all streetFull functionality.
     * @param {Object} ExtendableObject - The base object being extended
     * @returns {Promise<Object>} - Resolves to the StreetFullExtension object
     *
     * Executes all registration functions in sequence:
     * 1. registerProperties - Sets up internal state
     * 2. registerFields - Adds streetFull field
     * 3. registerConfig - Sets up templates and other configs
     * 4. registerEventCallbacks - Adds event handlers
     * 5. registerUtilities - Adds helper functions
     * 6. registerAPIHandlers - Sets up API communication
     * 7. registerFilterCallbacks - Adds data filters
     *
     * All registrations are handled asynchronously to ensure proper setup.
     * The extension object is returned to confirm successful extension.
     */
    extend: async (ExtendableObject) => {
        await StreetFullExtension.registerProperties(ExtendableObject);
        await StreetFullExtension.registerFields(ExtendableObject);
        await StreetFullExtension.registerConfig(ExtendableObject);
        await StreetFullExtension.registerEventCallbacks(ExtendableObject);
        await StreetFullExtension.registerUtilities(ExtendableObject);
        await StreetFullExtension.registerAPIHandlers(ExtendableObject);
        await StreetFullExtension.registerFilterCallbacks(ExtendableObject);

        return StreetFullExtension;
    }
};

export default StreetFullExtension;

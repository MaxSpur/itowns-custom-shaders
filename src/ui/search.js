import * as itowns from 'itowns';
import { Searchbar } from 'itowns/widgets';

const SEARCHBAR_DEFAULT_RANGE = 12000;
const SEARCHBAR_DEFAULT_TILT = 55;
const SEARCHBAR_DEFAULT_HEADING = 0;
const SEARCHBAR_MIN_QUERY_LENGTH = 3;

function getControlValue(view, methodName, fallbackValue) {
    const controls = view?.controls;
    if (typeof controls?.[methodName] !== 'function') {
        return fallbackValue;
    }

    const value = controls[methodName]();
    return Number.isFinite(value) ? value : fallbackValue;
}

function lookAtSearchCoordinate(view, coord) {
    const controls = view?.controls;
    if (!coord || typeof controls?.lookAtCoordinate !== 'function') {
        return;
    }

    const range = Math.min(
        Math.max(getControlValue(view, 'getRange', SEARCHBAR_DEFAULT_RANGE), 4000),
        20000,
    );
    const tilt = Math.min(
        Math.max(getControlValue(view, 'getTilt', SEARCHBAR_DEFAULT_TILT), 25),
        70,
    );
    const heading = getControlValue(view, 'getHeading', SEARCHBAR_DEFAULT_HEADING);

    controls.lookAtCoordinate({
        coord,
        range,
        tilt,
        heading,
    });
}

function clearSuggestions(form) {
    if (!form) {
        return;
    }

    while (form.children.length > 1) {
        form.removeChild(form.lastChild);
    }
}

export function initPlaceSearch(view) {
    const geocodingOptions = {
        url: new URL('https://data.geopf.fr/geocodage/completion?text='),
        parser: (response) => {
            const suggestions = new Map();

            for (const location of response?.results || []) {
                if (!Number.isFinite(location?.x) || !Number.isFinite(location?.y)) {
                    continue;
                }

                const label = location.fulltext || location.label || location.name;
                if (!label) {
                    continue;
                }

                suggestions.set(
                    label,
                    new itowns.Coordinates('EPSG:4326', location.x, location.y),
                );
            }

            return suggestions;
        },
        onSelected: (coord) => lookAtSearchCoordinate(view, coord),
    };

    const searchbar = new Searchbar(view, geocodingOptions, {
        width: 360,
        maxSuggestionNumber: 12,
        placeholder: 'Search a place or address (3+ chars)',
        position: 'top',
    });

    const form = searchbar.domElement.querySelector('form');
    const input = form?.querySelector('input');

    // The GeoPF completion endpoint rejects queries shorter than 3 characters.
    input?.addEventListener('input', (event) => {
        const query = event.target.value.trim();
        if (!query || query.length >= SEARCHBAR_MIN_QUERY_LENGTH) {
            return;
        }

        clearSuggestions(form);
        event.stopImmediatePropagation();
    }, true);

    return searchbar;
}

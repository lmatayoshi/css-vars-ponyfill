// TODO: Handle removal of a custom property declaration from the dom (remove from variableStore)
// TODO: Finish cleaning regex
// TODO: Finish updating tests
// TODO: Remove dist from repo
// TODO: Update option names
// TODO: Update docs


// Dependencies
// =============================================================================
import getCssData   from 'get-css-data';
import parseCss     from './parse-css';
import parseVars    from './parse-vars';
import stringifyCss from './stringify-css';
import transformCss from './transform-css';


// Constants & Variables
// =============================================================================
const isBrowser       = typeof window !== 'undefined';
const isNativeSupport = isBrowser && window.CSS && window.CSS.supports && window.CSS.supports('(--a: 0)');

const counters = {
    group: 0,
    job  : 0
};
const defaults = {
    // Targets
    rootElement  : isBrowser ? document : null,
    shadowDOM    : false,
    // Sources
    include      : 'style,link[rel=stylesheet]',
    exclude      : '',
    variables    : {},    // transformCss
    // Options
    fixNestedCalc: true,  // transformCss
    onlyLegacy   : true,  // cssVars
    onlyVars     : false, // cssVars, parseCSS
    preserve     : false, // transformCss
    silent       : false, // cssVars
    updateDOM    : true,  // cssVars
    updateURLs   : true,  // cssVars
    watch        : null,  // cssVars
    // Callbacks
    onBeforeSend() {},    // cssVars
    onSuccess() {},       // cssVars
    onWarning() {},       // transformCss
    onError() {},         // cssVars
    onComplete() {}       // cssVars
};
const regex = {
    // CSS keyframes (@keyframes & @-VENDOR-keyframes)
    cssKeyframes: /@(?:-\w*-)?keyframes/,
    // CSS root vars
    cssRootRules: /(?::root\s*{\s*[^}]*})/g,
    // CSS variable declarations (e.g. --color: red;)
    cssVarDecls: /(?:[\s;]*)(-{2}\w[\w-]*)(?:\s*:\s*)([^;]*);/g,
    // CSS variable function (e.g. var(--color))
    cssVarFunc: /var\(\s*--[\w-]/,
    // CSS variable :root declarations and var() function values
    cssVars: /(?:(?::root\s*{\s*[^;]*;*\s*)|(?:var\(\s*))(--[^:)]+)(?:\s*[:)])/
};
// Persisted custom property values (matches modern browsers)
const variableStore = {
    // Persisted across all ponyfill calls (emulates modern browser behavior)
    dom: {},
    // Temporary store for non-persisted values (i.e. options.updateDOM = false)
    job: {}
};

// Flag used to prevent successive ponyfill calls from stacking
let cssVarsIsRunning = false;

// Mutation observer reference created via options.watch
let cssVarsObserver = null;

// Debounce timer used with options.watch
let debounceTimer = null;

// Indicates if document-level custom property values have been parsed, stored,
// and ready for use with options.shadowDOM
let isShadowDOMReady = false;


// Functions
// =============================================================================
/**
 * Fetches, parses, and transforms CSS custom properties from specified
 * <style> and <link> elements into static values, then appends a new <style>
 * element with static values to the DOM to provide CSS custom property
 * compatibility for legacy browsers. Also provides a single interface for
 * live updates of runtime values in both modern and legacy browsers.
 *
 * @preserve
 * @param {object}   [options] Options object
 * @param {object}   [options.rootElement=document] Root element to traverse for
 *                   <link> and <style> nodes.
 * @param {boolean}  [options.shadowDOM=false] Determines if shadow DOM <link>
 *                   and <style> nodes will be processed.
 * @param {string}   [options.include="style,link[rel=stylesheet]"] CSS selector
 *                   matching <link re="stylesheet"> and <style> nodes to
 *                   process
 * @param {string}   [options.exclude] CSS selector matching <link
 *                   rel="stylehseet"> and <style> nodes to exclude from those
 *                   matches by options.include
 * @param {object}   [options.variables] A map of custom property name/value
 *                   pairs. Property names can omit or include the leading
 *                   double-hyphen (—), and values specified will override
 *                   previous values.
 * @param {boolean}  [options.fixNestedCalc=true] Remove nested 'calc' keywords
 *                   for legacy browser compatibility.
 * @param {boolean}  [options.onlyLegacy=true] Determines if the ponyfill will
 *                   only generate legacy-compatible CSS in browsers that lack
 *                   native support (i.e., legacy browsers)
 * @param {boolean}  [options.onlyVars=false] Determines if CSS rulesets and
 *                   declarations without a custom property value should be
 *                   removed from the ponyfill-generated CSS
 * @param {boolean}  [options.preserve=false] Determines if the original CSS
 *                   custom property declaration will be retained in the
 *                   ponyfill-generated CSS.
 * @param {boolean}  [options.silent=false] Determines if warning and error
 *                   messages will be displayed on the console
 * @param {boolean}  [options.updateDOM=true] Determines if the ponyfill will
 *                   update the DOM after processing CSS custom properties
 * @param {boolean}  [options.updateURLs=true] Determines if the ponyfill will
 *                   convert relative url() paths to absolute urls.
 * @param {boolean}  [options.watch=false] Determines if a MutationObserver will
 *                   be created that will execute the ponyfill when a <link> or
 *                   <style> DOM mutation is observed.
 * @param {function} [options.onBeforeSend] Callback before XHR is sent. Passes
 *                   1) the XHR object, 2) source node reference, and 3) the
 *                   source URL as arguments.
 * @param {function} [options.onSuccess] Callback after CSS data has been
 *                   collected from each node and before CSS custom properties
 *                   have been transformed. Allows modifying the CSS data before
 *                   it is transformed by returning any string value (or false
 *                   to skip). Passes 1) CSS text, 2) source node reference, and
 *                   3) the source URL as arguments.
 * @param {function} [options.onWarning] Callback after each CSS parsing warning
 *                   has occurred. Passes 1) a warning message as an argument.
 * @param {function} [options.onError] Callback after a CSS parsing error has
 *                   occurred or an XHR request has failed. Passes 1) an error
 *                   message, and 2) source node reference, 3) xhr, and 4 url as
 *                   arguments.
 * @param {function} [options.onComplete] Callback after all CSS has been
 *                   processed, legacy-compatible CSS has been generated, and
 *                   (optionally) the DOM has been updated. Passes 1) a CSS
 *                   string with CSS variable values resolved, 2) a reference to
 *                   the appended <style> node, 3) an object containing all
 *                   custom properies names and values, and 4) the ponyfill
 *                   execution time in milliseconds.
 *
 * @example
 *
 *   cssVars({
 *     rootElement  : document,
 *     shadowDOM    : false,
 *     include      : 'style,link[rel="stylesheet"]',
 *     exclude      : '',
 *     variables    : {},
 *     fixNestedCalc: true,
 *     onlyLegacy   : true,
 *     onlyVars     : false,
 *     preserve     : false,
 *     silent       : false,
 *     updateDOM    : true,
 *     updateURLs   : true,
 *     watch        : false,
 *     onBeforeSend(xhr, node, url) {},
 *     onSuccess(cssText, node, url) {},
 *     onWarning(message) {},
 *     onError(message, node, xhr, url) {},
 *     onComplete(cssText, styleNode, cssVariables, benchmark) {}
 *   });
 */
function cssVars(options = {}) {
    const msgPrefix = 'cssVars(): ';
    const settings  = Object.assign({}, defaults, options);

    function handleError(message, sourceNode, xhr, url) {
        /* istanbul ignore next */
        if (!settings.silent && window.console) {
            // eslint-disable-next-line
            console.error(`${msgPrefix}${message}\n`, sourceNode);
        }

        settings.onError(message, sourceNode, xhr, url);
    }

    function handleWarning(message) {
        /* istanbul ignore next */
        if (!settings.silent && window.console) {
            // eslint-disable-next-line
            console.warn(`${msgPrefix}${message}`);
        }

        settings.onWarning(message);
    }

    // Exit if non-browser environment (e.g. Node)
    if (!isBrowser) {
        return;
    }

    // Reset ponyfill flags and stored values
    if (settings.__reset) {
        settings.__reset = false;

        // Reset shadowDOM ready flag
        isShadowDOMReady = false;

        // Reset variable storage
        for (const prop in variableStore) {
            variableStore[prop] = {};
        }

        // Disconnect MutationObserver
        if (cssVarsObserver) {
            cssVarsObserver.disconnect();
        }
    }

    // Check flag and debounce to prevent successive call from stacking
    if (cssVarsIsRunning === settings.rootElement) {
        cssVarsDebounced(options);
        return;
    }

    // Add / recreate MutationObserver
    if (settings.watch) {
        addMutationObserver(settings);
        cssVars(settings);
        return;
    }
    // Disconnect existing MutationObserver
    else if (settings.watch === false && cssVarsObserver) {
        cssVarsObserver.disconnect();
    }

    // If benchmark key is not availalbe, this is a non-recursive call
    if (!settings.__benchmark) {
        // Store benchmark start time
        settings.__benchmark = getTimeStamp();

        // Fix malformed custom property names (e.g. "color" or "-color")
        settings.variables = fixVarNames(settings.variables);

        // Exclude previously processed elements
        if (!settings.watch) {
            settings.exclude = '[data-cssvars]:not([data-cssvars=""])' + (settings.exclude ? `,${settings.exclude}` : '');
        }
    }

    // Verify readyState to ensure all <link> and <style> nodes are available
    if (document.readyState !== 'loading') {
        const isShadowElm = settings.shadowDOM || settings.rootElement.shadowRoot || settings.rootElement.host;

        // Native support
        if (isNativeSupport && settings.onlyLegacy) {
            // Apply settings.variables
            if (settings.updateDOM) {
                const targetElm = settings.rootElement.host || (settings.rootElement === document ? document.documentElement : settings.rootElement);

                // Set variables using native methods
                Object.keys(settings.variables).forEach(key => {
                    targetElm.style.setProperty(key, settings.variables[key]);
                });
            }
        }
        // Ponyfill: Handle rootElement set to a shadow host or root
        else if (isShadowElm && !isShadowDOMReady) {
            // Get all document-level CSS
            getCssData({
                rootElement: defaults.rootElement,
                include: defaults.include,
                exclude: settings.exclude,
                onSuccess(cssText, node, url) {
                    const cssRootRules = (cssText.match(regex.cssRootRules) || []).join('');

                    // Return only matching :root {...} blocks
                    return cssRootRules || false;
                },
                onComplete(cssText, cssArray, nodeArray) {
                    // Parse variables and store in variableStore. This step
                    // ensures that variableStore contains all document-level
                    // custom property values for subsequent ponyfill calls.
                    parseVars(cssText, {
                        store    : variableStore.dom,
                        onWarning: handleWarning
                    });

                    isShadowDOMReady = true;

                    // Call the ponyfill again to process the rootElement
                    // initially specified. Values stored in variableStore will
                    // be used to transform values in shadow host/root elements.
                    cssVars(settings);
                }
            });
        }
        // Ponyfill: Process CSS
        else {
            // Set flag to prevent successive call from stacking. Using the
            // rootElement insead of `true` allows simultaneous ponyfill calls
            // using different rootElement values (e.g. documetn and one-or-more
            // shadowDOM nodes).
            cssVarsIsRunning = settings.rootElement;

            getCssData({
                rootElement : settings.rootElement,
                include     : settings.include,
                exclude     : settings.exclude,
                onBeforeSend: settings.onBeforeSend,
                onSuccess(cssText, node, url) {
                    const returnVal = settings.onSuccess(cssText, node, url);

                    // Use callback return value if provided (skip CSS if false)
                    cssText = returnVal !== undefined && Boolean(returnVal) === false ? '' : returnVal || cssText;

                    // Convert relative url(...) values to absolute
                    if (settings.updateURLs) {
                        cssText = fixRelativeCssUrls(cssText, url);
                    }

                    return cssText;
                },
                onError(xhr, node, url) {
                    const responseUrl = xhr.responseURL || getFullUrl(url, location.href);
                    const statusText  = xhr.statusText ? `(${xhr.statusText})` : 'Unspecified Error' + (xhr.status === 0 ? ' (possibly CORS related)' : '');
                    const errorMsg    = `CSS XHR Error: ${responseUrl} ${xhr.status} ${statusText}`;

                    handleError(errorMsg, node, xhr, responseUrl);
                },
                onComplete(cssText, cssArray, nodeArray = []) {
                    const jobVars  = {};
                    const varStore = settings.updateDOM ? variableStore.dom : Object.keys(variableStore.job).length ? variableStore.job : variableStore.job = JSON.parse(JSON.stringify(variableStore.dom));

                    let hasVarChange = false;

                    // Parse CSS and variables
                    nodeArray.forEach((node, i) => {
                        // Mark as skip node if CSS does not contain a custom
                        // property declaration or var() function
                        if (!regex.cssVars.test(cssArray[i])) {
                            node.setAttribute('data-cssvars', 'skip');
                        }
                        else {
                            try {
                                const cssTree = parseCss(cssArray[i], {
                                    onlyVars      : settings.onlyVars,
                                    removeComments: true
                                });

                                // Parse variables
                                parseVars(cssTree, {
                                    store    : jobVars,
                                    onWarning: handleWarning
                                });

                                // Cache data
                                node.__cssVars = { tree: cssTree };
                            }
                            catch(err) {
                                handleError(err.message, node);
                            }
                        }
                    });

                    // Merge settings.variables into jobVars
                    Object.assign(jobVars, settings.variables);

                    // Detect new variable declaration or value
                    hasVarChange = Boolean(Object.keys(varStore).length && Object.keys(jobVars).some(name => jobVars[name] !== varStore[name]));

                    // Merge jobVars into variable storage
                    Object.assign(varStore, jobVars);

                    // New variable declaration or modified value detected
                    if (hasVarChange) {
                        const srcNodes = Array.apply(null, settings.rootElement.querySelectorAll('[data-cssvars="src"]'));

                        srcNodes.forEach(node => node.setAttribute('data-cssvars', ''));
                        cssVars(settings);
                    }
                    // No variable changes detected
                    else {
                        const outCssArray  = [];
                        const outNodeArray = [];

                        let hasKeyframesWithVars = false;

                        // Reset temporary variable store
                        variableStore.job = {};

                        // Increment job
                        if (settings.updateDOM) {
                            counters.job++;
                        }

                        nodeArray
                            // Ignore nodes that could not be parsed
                            .filter(node => node.__cssVars)
                            .forEach(node => {
                                try {
                                    transformCss(node.__cssVars.tree, Object.assign({}, settings, {
                                        variables: varStore,
                                        onWarning: handleWarning
                                    }));

                                    const outCss = stringifyCss(node.__cssVars.tree);

                                    if (settings.updateDOM) {
                                        if (!node.getAttribute('data-cssvars')) {
                                            node.setAttribute('data-cssvars', 'src');
                                        }

                                        if (!node.getAttribute('data-cssvars-job')) {
                                            node.setAttribute('data-cssvars-job', counters.job);
                                        }

                                        if (outCss.length) {
                                            const dataGroup = node.getAttribute('data-cssvars-group') || ++counters.group;

                                            let outNode = settings.rootElement.querySelector(`[data-cssvars="out"][data-cssvars-group="${dataGroup}"]`);

                                            hasKeyframesWithVars = hasKeyframesWithVars || regex.cssKeyframes.test(outCss);

                                            if (!outNode) {
                                                outNode = document.createElement('style');
                                                outNode.setAttribute('data-cssvars', 'out');
                                                node.parentNode.insertBefore(outNode, node.nextSibling);
                                            }

                                            if (outNode && outNode.textContent !== outCss) {
                                                [node, outNode].forEach(n => {
                                                    n.setAttribute('data-cssvars-job', counters.job)
                                                    n.setAttribute('data-cssvars-group', dataGroup)
                                                });
                                                outNode.textContent = outCss;
                                                outCssArray.push(outCss);
                                                outNodeArray.push(outNode);
                                            }
                                        }
                                    }
                                    else {
                                        if (node.textContent !== outCss) {
                                            outCssArray.push(outCss);
                                        }
                                    }
                                }
                                catch(err) {
                                    handleError(err.message, node);
                                }
                            });

                        // Process shadow DOM
                        if (settings.shadowDOM) {
                            const elms = [
                                settings.rootElement,
                                ...settings.rootElement.querySelectorAll('*')
                            ];

                            // Iterates over all elements in rootElement and calls
                            // cssVars on each shadowRoot, passing document-level
                            // custom properties as options.variables.
                            for (let i = 0, elm; (elm = elms[i]); ++i) {
                                if (elm.shadowRoot && elm.shadowRoot.querySelector('style')) {
                                    const shadowSettings = Object.assign({}, settings, {
                                        rootElement: elm.shadowRoot,
                                        variables  : variableStore.dom
                                    });

                                    cssVars(shadowSettings);
                                }
                            }
                        }

                        // Fix keyframes
                        if (settings.updateDOM && hasKeyframesWithVars) {
                            fixKeyframes(settings.rootElement);
                        }

                        // Callback
                        settings.onComplete(
                            outCssArray.join(''),
                            outNodeArray,
                            JSON.parse(JSON.stringify(varStore)),
                            getTimeStamp() - settings.__benchmark
                        );
                    }

                    cssVarsIsRunning = false;
                }
            });
        }
    }
    // Delay function until DOMContentLoaded event is fired
    /* istanbul ignore next */
    else {
        document.addEventListener('DOMContentLoaded', function init(evt) {
            cssVars(options);

            document.removeEventListener('DOMContentLoaded', init);
        });
    }
}


// Functions (Private)
// =============================================================================
/**
 * Creates mutation observer that executes the ponyfill when a <link> or <style>
 * DOM mutation is observed.
 *
 * @param {object} settings
 */
function addMutationObserver(settings) {
    function isLink(node) {
        const isStylesheet = node.tagName === 'LINK' && (node.getAttribute('rel') || '').indexOf('stylesheet') !== -1;

        return isStylesheet && !node.disabled;
    }
    function isStyle(node) {
        return node.tagName === 'STYLE' && !node.disabled;
    }
    function isValidAddMutation(mutationNodes) {
        return Array.apply(null, mutationNodes).some(node => {
            const isElm           = node.nodeType === 1;
            const hasAttr         = isElm && node.hasAttribute('data-cssvars');
            const isStyleWithVars = isStyle(node) && regex.cssVars.test(node.textContent);
            const isValid         = !hasAttr && (isLink(node) || isStyleWithVars);

            return isValid;
        });
    }
    function isValidRemoveMutation(mutationNodes) {
        return Array.apply(null, mutationNodes).some(node => {
            const isElm     = node.nodeType === 1;
            const isOutNode = isElm && node.getAttribute('data-cssvars') === 'out';
            const isSrcNode = isElm && node.getAttribute('data-cssvars') === 'src';
            const isValid   = isSrcNode;

            if (isSrcNode || isOutNode) {
                const dataGroup  = node.getAttribute('data-cssvars-group');
                const orphanNode = settings.rootElement.querySelector(`[data-cssvars-group="${dataGroup}"]`);

                if (isSrcNode) {
                    const srcNodes = Array.apply(null, settings.rootElement.querySelectorAll('[data-cssvars="src"]'));

                    // Remove attributes and reprocess nodes via observer
                    srcNodes.forEach(node => node.setAttribute('data-cssvars', ''));
                }

                if (orphanNode) {
                    if (isSrcNode) {
                        // Remove orphaned output <style> node
                        orphanNode.parentNode.removeChild(orphanNode);
                    }
                    else {
                        // Remove attribute and reprocess src nodes on next ponyfill call
                        orphanNode.removeAttribute('data-cssvars');
                        orphanNode.removeAttribute('data-cssvars-group');
                        orphanNode.removeAttribute('data-cssvars-job');
                    }
                }
            }

            return isValid;
        });
    }

    if (!window.MutationObserver) {
        return;
    }

    if (cssVarsObserver) {
        cssVarsObserver.disconnect();
    }

    settings.watch = defaults.watch;

    cssVarsObserver = new MutationObserver(function(mutations) {
        const hasValidMutation = mutations.some((mutation) => {
            let isValid = false;

            if (mutation.type === 'attributes') {
                isValid = isLink(mutation.target);
            }
            else if (mutation.type === 'childList') {
                isValid = isValidAddMutation(mutation.addedNodes) || isValidRemoveMutation(mutation.removedNodes);
            }

            return isValid;
        });

        if (hasValidMutation) {
            cssVars(settings);
        }
    });

    cssVarsObserver.observe(document.documentElement, {
        attributes     : true,
        attributeFilter: ['disabled', 'href'],
        childList      : true,
        subtree        : true
    });
}

/**
 * Debounces cssVars() calls
 *
 * @param {object} settings
 */
function cssVarsDebounced(settings, delay = 100) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function() {
        settings.__benchmark = null;
        cssVars(settings);
    }, delay);
}

/**
 * Fixes issue with keyframe properties set using CSS custom property not being
 * applied properly in some legacy (IE) and modern (Safari) browsers.
 *
 * @param {object} rootElement
 */
function fixKeyframes(rootElement) {
    const animationNameProp = [
        'animation-name',
        '-moz-animation-name',
        '-webkit-animation-name'
    ].filter(prop => getComputedStyle(document.body)[prop])[0];

    if (animationNameProp) {
        const allNodes      = rootElement.getElementsByTagName('*');
        const keyframeNodes = [];
        const nameMarker    = '__CSSVARSPONYFILL-KEYFRAMES__';

        // Modify animation name
        for (let i = 0, len = allNodes.length; i < len; i++) {
            const node          = allNodes[i];
            const animationName = getComputedStyle(node)[animationNameProp];

            if (animationName !== 'none') {
                node.style[animationNameProp] += nameMarker;
                keyframeNodes.push(node);
            }
        }

        // Force reflow
        void document.body.offsetHeight;

        // Restore animation name
        for (let i = 0, len = keyframeNodes.length; i < len; i++) {
            const nodeStyle = keyframeNodes[i].style;

            nodeStyle[animationNameProp] = nodeStyle[animationNameProp].replace(nameMarker, '');
        }
    }
}

/**
 * Convert relative CSS url(...) values to absolute based on baseUrl
 *
 * @param {string} cssText
 * @param {string} baseUrl
 * @returns {string}
 */
function fixRelativeCssUrls(cssText, baseUrl) {
    const regex = {
        // CSS comments
        cssComments: /\/\*[\s\S]+?\*\//g,
        cssUrls: /url\((?!['"]?(?:data|http|\/\/):)['"]?([^'")]*)['"]?\)/g,
    };

    const cssUrls = cssText
        // Remove comments
        .replace(regex.cssComments, '')
        // Match url(...) values
        .match(regex.cssUrls) || [];

    cssUrls.forEach(cssUrl => {
        const oldUrl = cssUrl.replace(regex.cssUrls, '$1');
        const newUrl = getFullUrl(oldUrl, baseUrl);

        cssText = cssText.replace(cssUrl, cssUrl.replace(oldUrl, newUrl));
    });

    return cssText;
}

/**
 * Converts all object property names to leading '--' style
 *
 * @param {object} varObj Object containing CSS custom property name:value pairs
 * @returns {object}
 */
function fixVarNames(varObj) {
    const userVarNames        = Object.keys(varObj);
    const reLeadingHyphens    = /^-{2}/;
    const hasMalformedVarName = userVarNames.some(key => !reLeadingHyphens.test(key));

    if (hasMalformedVarName) {
        varObj = userVarNames.reduce((obj, value) => {
            const key = reLeadingHyphens.test(value) ? value : `--${value.replace(/^-+/, '')}`;

            obj[key] = varObj[value];

            return obj;
        }, {});
    }

    return varObj;
}

/**
 * Returns fully qualified URL from relative URL and (optional) base URL
 *
 * @param   {string} url
 * @param   {string} [base=location.href]
 * @returns {string}
 */
function getFullUrl(url, base = location.href) {
    const d = document.implementation.createHTMLDocument('');
    const b = d.createElement('base');
    const a = d.createElement('a');

    d.head.appendChild(b);
    d.body.appendChild(a);
    b.href = base;
    a.href = url;

    return a.href;
}

/**
 * Returns a time stamp in milliseconds
 *
 * @returns {number}
 */
function getTimeStamp() {
    return isBrowser && window.performance.now ? performance.now() : new Date().getTime();
}


// Export
// =============================================================================
export default cssVars;

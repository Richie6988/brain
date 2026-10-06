//////////////////// PERFORMING A ZOOM ////////////////////

const defaultZoom = 1;
let currentZoom = defaultZoom;
let prevZoom;
const zoomStep = 0.95; 
let isZooming = false;

// Garde-fous du zoom au geste (événements du navigateur seulement : la caméra du Gardien et les bancs passent) :
// - un événement qui attend depuis plus de ZOOM_LAG ms est un retard en file (≈ 6 événements), il est jeté ;
// - zoom min ou max atteint : la suite du geste dans ce sens est jetée, le sens inverse repart tout de suite ;
// - souris déplacée pendant le geste : la suite du geste est jetée ;
// - changement de sens : la file de l'ancien sens est vidée, et ses restes arrivés dans les ZOOM_LAG ms suivantes jetés ;
// - file globale (zoomPending) plafonnée à ZOOM_QUEUE pas : un événement de pincement compte un pas, un cran de molette
//   ses pas ; au-delà du plafond ils sont ignorés. La file est appliquée à l'image suivante, un zoom d'origine (5 %) par pas.
// Un geste finit après ZOOM_GESTURE ms sans événement ; le suivant repart sans blocage.
const ZOOM_LAG = 100;
const ZOOM_GESTURE = 150;
const ZOOM_MOVE = 8;  // px de déplacement de la souris qui arrêtent le geste
const ZOOM_QUEUE = 3;  // pas de zoom en attente au plus
let zoomPending = 0, zoomFrame = 0;
let zoomLast = -Infinity, zoomLimit = 0, zoomStopped = false, zoomDirection = 0, zoomTurn = -Infinity, zoomPointer = null;
function zoomAccepted(event) {
    if (event.timeStamp - zoomLast > ZOOM_GESTURE) { zoomLimit = 0; zoomStopped = false; }
    zoomLast = event.timeStamp;
    zoomPointer = { x: event.clientX, y: event.clientY };
    const direction = Math.sign(event.deltaY);
    if (direction !== zoomDirection) {
        if (event.timeStamp - zoomTurn < ZOOM_LAG && direction === -zoomDirection) return false;  // reste de l'ancien sens
        zoomDirection = direction;
        zoomTurn = event.timeStamp;
        zoomPending = 0;  // la file de l'ancien sens est vidée
    }
    if (zoomStopped || direction === zoomLimit) return false;
    return performance.now() - event.timeStamp <= ZOOM_LAG;
}
window.addEventListener('mousemove', event => {
    if (zoomPointer && performance.now() - zoomLast < ZOOM_GESTURE
        && Math.hypot(event.clientX - zoomPointer.x, event.clientY - zoomPointer.y) > ZOOM_MOVE) { zoomStopped = true; zoomPending = 0; }
});
// Applique la file : les pas en attente, dans le sens courant, jusqu'à la butée.
function zoomFlush() {
    zoomFrame = 0;
    const event = { deltaY: zoomDirection };
    for (; zoomPending > 0; zoomPending--) {
        const before = currentZoom;
        zoom(event);
        if (currentZoom === before) { zoomLimit = zoomDirection; zoomPending = 0; break; }  // butée : la suite du geste dans ce sens est jetée
    }
    sizeCurrent();
}

// Pas de zoom natif du navigateur dans toute l'app : Ctrl + molette ou pincement hors de l'univers (panneaux, dock,
// chat), Ctrl + / - / 0, gestes de pincement de Safari. Dans l'univers, le pincement reste le zoom de Nodz (plus bas).
window.addEventListener('wheel', event => { if (event.ctrlKey) event.preventDefault(); }, { passive: false });
window.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && ['+', '-', '=', '_', '0'].includes(event.key)) event.preventDefault();
});
['gesturestart', 'gesturechange', 'gestureend'].forEach(type => document.addEventListener(type, event => event.preventDefault()));

// Event listener for the wheel event (pinch-to-zoom)
svg.addEventListener('wheel', function(event) { 
    if (!event.ctrlKey && scrollsInside(event)) return;  // un contenu défilant dans un node (sortie, aperçu) défile
    event.preventDefault(); 
    const deltaY = event.deltaY;
    const deltaX = event.deltaX;

    const mouse = mouseWheel(event);
    if (deltaY === Math.round(deltaY) && (!mouse || event.shiftKey)) {
        // Two-finger movement detected (or Shift + mouse wheel)
        dragUniverse(-deltaX,-deltaY,false)
         
    } else {        
        // Pinch zoom detected, or a mouse wheel notch
        if(!isCtrlPressed && !preview){
            if (event.isTrusted && !zoomAccepted(event)) return;
            if(!isZooming) {
                areaWidth = window.innerWidth;
                areaHeight = window.innerHeight;             
                zoomX = Math.round((event.clientX - centerX) + parseFloat(root.getAttribute('x')))/currentZoom;
                zoomY = -Math.round((event.clientY - centerY) - parseFloat(root.getAttribute('y')))/currentZoom;    
                isZooming = true;
            }  
            // A mouse notch zooms several steps at once, a pinch one step per event
            const steps = mouse ? Math.min(4, Math.max(1, Math.round(event.deltaMode === 1 ? Math.abs(deltaY) : Math.abs(deltaY) / 40))) : 1;
            if (event.isTrusted) {  // geste réel : ses pas dans la file, appliquée à l'image suivante
                zoomPending = Math.min(ZOOM_QUEUE, zoomPending + steps);
                if (!zoomFrame) zoomFrame = requestAnimationFrame(zoomFlush);
                return;
            }
            for (let i = 0; i < steps; i++) zoom(event);
        } else {
            event.stopPropagation();
        }     
    }
    sizeCurrent();
});

function sizeCurrent() {
    if(currentNode){
        var r = parseFloat(currentNode.children[1].getAttribute('r'));
        r = Math.sqrt(2*r*r);
        nodeSizing(currentNode,r,r);
    }
}

// Un élément HTML défilant sous le pointeur, entre lui et l'univers, qui peut encore défiler dans ce sens ?
function scrollsInside(event) {
    for (let el = event.target; el && el !== svg; el = el.parentNode) {
        if (!(el instanceof HTMLElement) || el.scrollHeight <= el.clientHeight + 1) continue;
        const overflow = getComputedStyle(el).overflowY;
        if (overflow !== 'auto' && overflow !== 'scroll') continue;
        if (event.deltaY < 0 ? el.scrollTop > 0 : el.scrollTop + el.clientHeight < el.scrollHeight - 1) return true;
    }
    return false;
}

// A mouse wheel (notches) rather than a touchpad: lines in Firefox, multiples of 120 in Chrome and Safari,
// except the Mac touchpad signature (wheelDeltaY = -3 x deltaY)
function mouseWheel(event) {
    if (event.deltaMode === 1) return true;
    const notch = event.wheelDeltaY;
    return !event.deltaX && !!notch && notch % 120 === 0 && notch !== -3 * event.deltaY;
}

function zoom(event) {  
    // Get the delta value to determine the direction of the scroll (positive for zooming out, negative for zooming in)
    const delta = event.deltaY || event.detail || event.wheelDelta;
    const zoomOut = delta > 0;    
    const minZoom = (defaultZoom * Math.pow(zoomStep, 50)).toFixed(2); 
    const maxZoom = (defaultZoom / Math.pow(zoomStep, 42)).toFixed(2);   
    // areaWidth = window.innerWidth;
    // areaHeight = window.innerHeight; 

    var prev = currentZoom;
    if (zoomOut) {
        currentZoom = Math.max(minZoom, currentZoom * zoomStep).toFixed(3); // Decrease the zoom level for zooming out
    } else {
        currentZoom = Math.min(maxZoom, currentZoom / zoomStep).toFixed(3); // Increase the zoom level for zooming in 
    }
    
    dragUniverse(parseFloat((-centerX)*(currentZoom - prev)),parseFloat((-centerY)*(currentZoom - prev)),false,'zoom');
    dragUniverse(parseFloat((-zoomX)*(currentZoom - prev)),parseFloat((zoomY)*(currentZoom - prev)),false,'');  
}   


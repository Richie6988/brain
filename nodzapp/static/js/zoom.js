//////////////////// PERFORMING A ZOOM ////////////////////

const defaultZoom = 1;
let currentZoom = defaultZoom;
let prevZoom;
const zoomStep = 0.95; 
// Pincement : le zoom suit l'amplitude du geste (facteur exp(-deltaY x PINCH) : à 0.01, exactement l'écart des doigts,
// comme le zoom natif du navigateur), au plus un pas de zoomStep par événement. Plus petit : moins sensible.
const PINCH = 0.01;
let isZooming = false;
// Pendant un pincement, l'univers déjà dessiné est agrandi par le navigateur (transformation CSS du SVG, sans redessiner
// aucun node) ; le vrai zoom de Nodz s'applique quand le geste s'arrête (PINCH_IDLE ms sans événement) ou dès que
// l'échelle a beaucoup changé (les nodes qui entrent alors à l'écran s'affichent). Redessiner toute la carte à chaque
// événement prenait plus de temps qu'il n'en sépare deux : le zoom partait en retard et continuait après le geste.
const PINCH_IDLE = 140;
const minZoom = (defaultZoom * Math.pow(zoomStep, 50)).toFixed(2);
const maxZoom = (defaultZoom / Math.pow(zoomStep, 42)).toFixed(2);
let pinchScale = 1, pinchTimer = 0;
function pinchPreview(rate) {
    pinchScale = Math.min(maxZoom, Math.max(minZoom, currentZoom * pinchScale * rate)) / currentZoom;
    // Le point fixe du zoom de Nodz (zoomX, zoomY), à l'écran : l'aperçu grandit autour de lui, comme le zoom final.
    const x = zoomX * currentZoom - parseFloat(root.getAttribute('x')) + centerX;
    const y = -zoomY * currentZoom + parseFloat(root.getAttribute('y')) + centerY;
    svg.style.willChange = 'transform';
    svg.style.transformOrigin = `${x}px ${y}px`;
    svg.style.transform = `scale(${pinchScale})`;
    clearTimeout(pinchTimer);
    if (pinchScale > 1.8 || pinchScale < 0.55) pinchCommit();
    else pinchTimer = setTimeout(pinchCommit, PINCH_IDLE);
}
function pinchCommit() {
    clearTimeout(pinchTimer);
    if (pinchScale === 1) return;
    const rate = pinchScale;
    pinchScale = 1;
    svg.style.transform = '';
    svg.style.willChange = '';
    zoom({ deltaY: 0 }, rate);
    sizeCurrent();
}
// Tout autre geste (clic, glissé, touche) part de la vue réelle : le zoom en attente s'applique d'abord.
['pointerdown', 'keydown'].forEach(type => window.addEventListener(type, pinchCommit, true));

// Event listener for the wheel event (pinch-to-zoom)
svg.addEventListener('wheel', function(event) { 
    if (!event.ctrlKey && scrollsInside(event)) return;  // un contenu défilant dans un node (sortie, aperçu) défile
    const pinch = event.ctrlKey && event.isTrusted;
    if (!pinch) pinchCommit();  // molette, glissé à deux doigts, caméra du Gardien : depuis la vue réelle
    event.preventDefault(); 
    const deltaY = event.deltaY;
    const deltaX = event.deltaX;

    const mouse = mouseWheel(event);
    // Ctrl + molette sans touche Ctrl enfoncée : un pincement du trackpad, même à deltaY entier (sinon il glissait la vue)
    if (deltaY === Math.round(deltaY) && (!mouse || event.shiftKey) && !event.ctrlKey) {
        // Two-finger movement detected (or Shift + mouse wheel)
        dragUniverse(-deltaX,-deltaY,false)
         
    } else {        
        // Pinch zoom detected, or a mouse wheel notch
        if(!isCtrlPressed && !preview){
            if(!isZooming) {
                areaWidth = window.innerWidth;
                areaHeight = window.innerHeight;             
                zoomX = Math.round((event.clientX - centerX) + parseFloat(root.getAttribute('x')))/currentZoom;
                zoomY = -Math.round((event.clientY - centerY) - parseFloat(root.getAttribute('y')))/currentZoom;    
                isZooming = true;
            }  
            // Pincement du trackpad : Ctrl + molette envoyé par le navigateur (touche Ctrl relâchée, sinon on n'arrive pas
            // ici), souvent avec wheelDeltaY = -120 comme un cran de souris : il zoomait de 5 % par événement, près de
            // 7 fois le geste. Il suit maintenant les doigts. Les molettes simulées (Tab, caméra du Gardien) gardent
            // leur pas exact : leurs boucles comptent dessus. A mouse notch zooms several steps at once.
            if (pinch) {
                pinchPreview(Math.min(1 / zoomStep, Math.max(zoomStep, Math.exp(-deltaY * PINCH))));
            } else {
                const steps = mouse ? Math.min(4, Math.max(1, Math.round(event.deltaMode === 1 ? Math.abs(deltaY) : Math.abs(deltaY) / 40))) : 1;
                for (let i = 0; i < steps; i++) zoom(event);
            }
        } else {
            event.stopPropagation();
        }     
    }
    if (!pinch) sizeCurrent();  // pendant l'aperçu d'un pincement rien n'a bougé : au zoom réel (pinchCommit)
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

function zoom(event, rate) {  // rate : facteur de zoom d'un pincement ; sans lui, un pas de zoomStep
    // Get the delta value to determine the direction of the scroll (positive for zooming out, negative for zooming in)
    const delta = event.deltaY || event.detail || event.wheelDelta;
    const zoomOut = delta > 0;    
    // areaWidth = window.innerWidth;
    // areaHeight = window.innerHeight; 

    var prev = currentZoom;
    if (rate) {
        currentZoom = Math.min(maxZoom, Math.max(minZoom, currentZoom * rate)).toFixed(4);
    } else if (zoomOut) {
        currentZoom = Math.max(minZoom, currentZoom * zoomStep).toFixed(3); // Decrease the zoom level for zooming out
    } else {
        currentZoom = Math.min(maxZoom, currentZoom / zoomStep).toFixed(3); // Increase the zoom level for zooming in 
    }
    
    dragUniverse(parseFloat((-centerX)*(currentZoom - prev)),parseFloat((-centerY)*(currentZoom - prev)),false,'zoom');
    dragUniverse(parseFloat((-zoomX)*(currentZoom - prev)),parseFloat((zoomY)*(currentZoom - prev)),false,'');  
}   


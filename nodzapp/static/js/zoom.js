//////////////////// PERFORMING A ZOOM ////////////////////

const defaultZoom = 1;
let currentZoom = defaultZoom;
let prevZoom;
const zoomStep = 0.95; 
let isZooming = false;

// Event listener for the wheel event (pinch-to-zoom)
svg.addEventListener('wheel', function(event) { 
    event.preventDefault(); 
    const deltaY = event.deltaY;
    const deltaX = event.deltaX;

    if (deltaY === Math.round(deltaY)) {
        // Two-finger movement detected
        dragUniverse(-deltaX,-deltaY,false)
         
    } else {        
        // Pinch zoom detected
        if(!isCtrlPressed && !preview){
            if(!isZooming) {
                areaWidth = window.innerWidth;
                areaHeight = window.innerHeight;             
                zoomX = Math.round((event.clientX - centerX) + parseFloat(root.getAttribute('x')))/currentZoom;
                zoomY = -Math.round((event.clientY - centerY) - parseFloat(root.getAttribute('y')))/currentZoom;    
                isZooming = true;
            }  
            zoom(event);
        } else {
            event.stopPropagation();
        }     
    }
    if(currentNode){
        var r = parseFloat(currentNode.children[1].getAttribute('r'));
        r = Math.sqrt(2*r*r);
        nodeSizing(currentNode,r,r);
    }
});

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


//////////////////// MANUAL DRAW ////////////////////  

var isDrawing = false;
var lastX = 0;
var lastY = 0;
var X = 0;
var Y = 0;

function startDrawing(e,canvasID, canvasUndoCounter, drawingData,preventDrawing) {
    if (!preventDrawing){
        ctx = document.getElementById(canvasID).getContext('2d');
        isDrawing = true;
        let rect = document.getElementById(canvasID).getBoundingClientRect();
        X = (e.clientX - rect.left)/currentZoom;
        Y = (e.clientY - rect.top)/currentZoom;   

        let newOperation = {
            type: 'path',
            color: ctx.strokeStyle, 
            lineWidth: ctx.lineWidth,   
            points: [{ x: X, y: Y }] // Start with the initial point
        };
        drawingData.length = drawingData.length + canvasUndoCounter;
        // Store the new drawing operation in the array
        drawingData.push(newOperation);
        [lastX, lastY] = [X, Y];
    }    

    return drawingData
}

function draw(e,canvasID, drawingData) {
    if (!isDrawing) return;
  
    ctx = document.getElementById(canvasID).getContext('2d');
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    let rect = document.getElementById(canvasID).getBoundingClientRect();
    X = (e.clientX - rect.left)/currentZoom;
    Y = (e.clientY - rect.top)/currentZoom;
    drawingData[drawingData.length - 1].points.push({ x: X, y: Y });
    ctx.lineTo(X, Y);
    ctx.stroke();
    [lastX, lastY] = [X, Y];
    return drawingData
}

function redrawCanvas(canvasID,delta,drawingData) {
    // Clear the canvas
    var canvas = document.getElementById(canvasID);
    ctx = document.getElementById(canvasID).getContext('2d');  
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if(drawingData){
        // Iterate over the drawing data and redraw each operation
        for (let i = 0; i < drawingData.length + delta; i++) {
            const operation = drawingData[i];   
            ctx.beginPath();
            if (dark && operation.color === '#000000') {
                ctx.strokeStyle = '#ffffff';
            } else if (!dark && operation.color === '#ffffff') {
                ctx.strokeStyle = '#000000';
            } else {
                ctx.strokeStyle = operation.color;
            }            
            ctx.lineWidth = operation.lineWidth;
            
            if(operation.type === 'path'){
                ctx.moveTo(parseFloat(operation.points[0].x), parseFloat(operation.points[0].y));        
                for (let i = 1; i < operation.points.length; i++) {
                    ctx.lineTo(operation.points[i].x, operation.points[i].y);
                    ctx.moveTo(operation.points[i].x, operation.points[i].y);                        
                }
            } else if(operation.type === 'circle'){
                ctx.arc(operation.center[0].x, operation.center[0].y, operation.radius, 0, 2 * Math.PI);
            }            
            ctx.stroke();
        }
    }
}

function stopDrawing(nodeGroup, drawingData) {
    isDrawing = false;
    const drawingDataString = JSON.stringify(drawingData);
    nodeGroup.setAttribute('canvascontent',drawingDataString);
  
}

// Flag to indicate if the first click has been made
let isFirstClick = true;
let isSecondClick = false;

//////////////////// DRAW LINE ////////////////////  

let isLining = false;

function drawLine(event,canvasID,canvasButton6img,drawingData,nodeGroup) {
    isLining = true;
    isCircling = false;

    const canvas = document.getElementById(canvasID);
    var ctx = canvas.getContext('2d');
    // Get mouse coordinates relative to the canvas
    const rect = canvas.getBoundingClientRect();

    const mouseX = (event.clientX - rect.left)/currentZoom;
    const mouseY = (event.clientY - rect.top)/currentZoom;
    
    // If it's the first click, store the start coordinates
    if (isFirstClick) {
        lastX = mouseX;
        lastY = mouseY;

        let newOperation = {
            type: 'path',
            color: ctx.strokeStyle, 
            lineWidth: ctx.lineWidth,   
            points: [{ x: lastX, y: lastY }] // Start with the initial point
        };
    
        // Store the new drawing operation in the array
        drawingData.push(newOperation);
        drawingData[drawingData.length - 1].points.push({ x: lastX, y: lastY });

        canvas.addEventListener('mousemove', function(event) {
            if(isLining){
                drawLine(event,canvasID, canvasButton6img, drawingData, nodeGroup);
            }           
        }, { once: false });

        isFirstClick = false;
    } else {
        ctx.beginPath();
        ctx.moveTo(lastX, lastY);
        let rect = document.getElementById(canvasID).getBoundingClientRect();
        X = (event.clientX - rect.left)/currentZoom;
        Y = (event.clientY - rect.top)/currentZoom;
        drawingData[drawingData.length - 1].points[0].x = X;
        drawingData[drawingData.length - 1].points[0].y = Y;
        ctx.lineTo(X, Y);
        ctx.stroke();

        redrawCanvas(canvasID,0,drawingData);        
        
        canvas.addEventListener('mouseup', function(event) {
            // Reset for the next line         
            isFirstClick = true;
            isLining = false;
            canvasButton6img.setAttribute('src', '/static/img/line.svg'); 

            const drawingDataString = JSON.stringify(drawingData);
            nodeGroup.setAttribute('canvascontent',drawingDataString);
            }, { once: true });
    }
}

//////////////////// DRAW CIRCLE ////////////////////  

// Variables to store click coordinates
let circleX = 0;
let circleY = 0;
let isCircling = false;

// Event listener for mouse clicks on the canvas
function drawCircle(event,canvasID,canvasButton7img,drawingData,nodeGroup) {
    isLining = false;
    isCircling = true;

    const canvas = document.getElementById(canvasID);
    var ctx = canvas.getContext('2d');
  
    // Get mouse coordinates relative to the canvas
    const rect = canvas.getBoundingClientRect();

    const mouseX = (event.clientX - rect.left)/currentZoom;
    const mouseY = (event.clientY - rect.top)/currentZoom;
    
    // If it's the first click, store the center coordinates
    if (isFirstClick) {
        circleX = mouseX;
        circleY = mouseY;
        const radius = Math.sqrt(Math.pow(mouseX - circleX, 2) + Math.pow(mouseY - circleY, 2));
        // Draw the circle using the stored center coordinates and calculated radius
        ctx.beginPath();
        ctx.arc(circleX, circleY, radius, 0, 2 * Math.PI);
        ctx.stroke();
        let color = ctx.strokeStyle;
        let newOperation = {
            type: 'circle',
            color: ctx.strokeStyle, 
            lineWidth: ctx.lineWidth,   
            center: [{ x: circleX, y: circleY }],
            radius: radius,
        };
        drawingData.push(newOperation);

        canvas.addEventListener('mousemove', function(event) {
            if(isCircling){
                drawCircle(event,canvasID, canvasButton7img, drawingData, nodeGroup);
            }           
        }, { once: false });

        isFirstClick = false;
    } else {
        // Calculate the distance between the two points to determine the radius
        const radius = Math.sqrt(Math.pow(mouseX - circleX, 2) + Math.pow(mouseY - circleY, 2));

        let newOperation = {
            type: 'circle',
            color: ctx.strokeStyle, 
            lineWidth: ctx.lineWidth,   
            center: [{ x: circleX, y: circleY }],
            radius: radius,
        };
        drawingData[drawingData.length-1] = newOperation;
        redrawCanvas(canvasID,0,drawingData);

        canvas.addEventListener('mouseup', function(event) {
            // Reset for the next circle          
            isFirstClick = true;
            isCircling = false;
            canvasButton7img.setAttribute('src', '/static/img/circle.svg'); 

            const drawingDataString = JSON.stringify(drawingData);
            nodeGroup.setAttribute('canvascontent',drawingDataString);

            }, { once: true });
    }
}


//////////////////// REMOVE CANVAS OBJECTS ////////////////////

function removeIntersectingObjects(drawingData, mouseX, mouseY, canvasUndoCounter) {
    // Iterate over the drawing data and remove objects that intersect with the given point
    for (let i = 0; i < drawingData.length + canvasUndoCounter; i++) {
        const operation = drawingData[i];
        switch (operation.type) {
            case 'path':
                // Check if the point intersects with any points in the path
                for (let j = 0; j < operation.points.length; j++) {
                    const point = operation.points[j];
                    const distance = Math.sqrt(Math.pow(point.x - mouseX, 2) + Math.pow(point.y - mouseY, 2));
                    if (distance <= 5) {
                        // Remove the path if it intersects with the point
                        const removedElement = drawingData.splice(i, 1)[0];
                        // Add the removed element to the end of the array
                        drawingData.push(removedElement);
                        canvasUndoCounter--; 
                        i--;
                        return drawingData, canvasUndoCounter;
                    }
                }
                break;
            case 'circle':
                // Check if the point intersects with the circle
                const distanceToCenter = Math.sqrt(Math.pow(operation.center[0].x - mouseX, 2) + Math.pow(operation.center[0].y - mouseY, 2));
                if (distanceToCenter <= operation.radius) {
                    // Remove the circle if it intersects with the point
                    const removedElement = drawingData.splice(i, 1)[0];
                    // Add the removed element to the end of the array
                    drawingData.push(removedElement);
                    canvasUndoCounter--; 
                    i--;
                    return drawingData, canvasUndoCounter;
                }
                break;
        }
    } return drawingData, canvasUndoCounter;
}


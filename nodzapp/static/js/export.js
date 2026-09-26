const squares = document.querySelectorAll('.square');
const progressText = document.getElementById('progress');
const loaderContainer = document.getElementById('loader');
const exportBtn = document.getElementById('exportBtn');
let exportMax = 0;
let exportIter = 0;
const toggleSwitch = document.getElementById('toggleSwitch');
let selectedMode = 'selected_nodes'; // Default value
let nodesToExport;
let templatesToExport;

toggleSwitch.addEventListener('change', () => {
    selectedMode = toggleSwitch.checked ? 'whole_dimension' : 'selected_nodes';
    if (selectedMode === 'whole_dimension'){
        exportBtn.disabled = false;
        nodesToExport = document.querySelectorAll('.node-group');
        templatesToExport = document.querySelectorAll('.template');
    } else if(selectedNodes.length > 0 || selectedTemplates.length > 0) {   
        nodesToExport = selectedNodes;
        templatesToExport = selectedTemplates
        exportBtn.disabled = false;
    } else {
        exportBtn.disabled = true;
    }
});

function updateProgress() {
  const progress = Math.round((100*exportIter)/exportMax);
  if (progress < 100) {
    const squaresToFill = Math.floor((progress / 100) * squares.length);
    squares.forEach((square, index) => {
      if (index < squaresToFill) {
        square.classList.add('active');
      } else {
        square.classList.remove('active');
      }
    });
    progressText.textContent = `${progress}%`;
  } else {
    exportBtn.disabled = false;
    exportBtn.textContent = 'Save';

    setTimeout(() => {
      loaderContainer.style.display = 'none';
      progressText.textContent = '';
      currentProgress = 0;
    }, 100);
  }
}

exportBtn.addEventListener('click', () => {  
    toggleSwitch.value = 'selected_nodes';
    toggleSwitch.checked = false;
    exportIter = 0;  
    if (exportBtn.textContent === 'Save') {    
        exportSVGToPDF(extract);
        document.body.removeChild(extract);
        document.getElementById('export').style.display = 'none';
        extract = null;
        return     
    } else { 
        exportBtn.disabled = true;
        loaderContainer.style.display = 'flex';
        squares.forEach(square => square.classList.remove('active'));

        selectedLinks.length = 0;
        nodesToExport.forEach(node => {
            var links = JSON.parse(node.getAttribute('links'));
            links.forEach(id => {
                // Check if the ID is not already in the links array
                if (!selectedLinks.includes(id)) {
                    selectedLinks.push(id);
                }
            });
        });
        exportMax = nodesToExport.length + selectedLinks.length + templatesToExport.length;
        updateProgress();
        setTimeout(() => {
            exportNodz(nodesToExport,selectedLinks, templatesToExport);
        }, 50);
    }
});

let extract;

async function exportNodz(nodesSelection, linksSelection, templatesSelection) {
    extract = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    extract.style.position = 'fixed';
    extract.style.left = 0;  
    extract.style.top = 0;
    extract.style.width = 500;  
    extract.style.height = 500;
    extract.style.pointerEvents = 'none';
    extract.style.zIndex = -1000;
    document.body.appendChild(extract);

    let minX = Infinity, maxY = -Infinity;
    // Find relative position to place nodes in extract
    nodesSelection.forEach(node => {
        if (node.getAttribute('type') === 'video' || node.getAttribute('type') === 'file'){
            const type = node.getAttribute('type');
            var event = new Event('change');
            node.children[7].children[0].children[0].value = 'text';    
            node.children[7].children[0].children[0].dispatchEvent(event); 
            if (type === 'video') {
                node.children[0].children[0].innerHTML = '<span style="color: black; text-decoration: underline;font-size: smaller;">Watch here:</span>\n' + '<span style="color: black; font-size: small;">' + node.getAttribute('videocontent') + '</span>';
            } else {
                node.children[0].children[0].innerHTML = '<span style="color: black; text-decoration: underline;font-size: smaller;">Get file:</span>\n' + '<span style="color: black; font-size: small;">' + node.getAttribute('filename') + '</span>';
            }
            var inputEvent = new Event('input');
            node.children[0].children[0].dispatchEvent(inputEvent);
            node.setAttribute('type',type);     
        }
        const x = parseFloat(node.getAttribute('x'));
        const y = parseFloat(node.getAttribute('y'));
        const r = parseFloat(node.children[1].getAttribute('r'));

        minX = Math.min(minX, x-r);
        maxY = Math.max(maxY, y+r);
    });

    var mouseEvent = new Event('mousedown');
    svg.dispatchEvent(mouseEvent);

    templatesSelection.forEach(template => {
        const clone = template.cloneNode(true);
        const x = parseFloat(clone.getAttribute('x'));
        const y = parseFloat(clone.getAttribute('y'));
        extract.appendChild(clone);
        for (let i = 2; i >= 0; i--) {
            clone.removeChild(clone.children[i]); 
        } 
        const height = parseFloat(clone.getBBox().height);
        const width = parseFloat(clone.getBBox().width);
        minX = Math.min(minX, x - width/2);
        maxY = Math.max(maxY, y + height/2); 
        extract.removeChild(clone);    
    });
    
    templatesSelection.forEach(template => {
        const clone = template.cloneNode(true);
        const cloneX = parseFloat(clone.getAttribute('x'));
        const cloneY = parseFloat(clone.getAttribute('y'));

        for (let i = 2; i >= 0; i--) {
            clone.removeChild(clone.children[i]); 
        } 
   
        // Reset old positioning of clone
        clone.removeAttribute('x');  
        clone.removeAttribute('y');  
        clone.removeAttribute('transform');
        // Move clone relative to extract
        const transfoX = cloneX - minX + 5;
        const transfoY = -cloneY + maxY + 5;

        clone.setAttribute('transform', `translate(${(transfoX)}, ${(transfoY)})`);
        extract.appendChild(clone); 
        clone.style.display = 'block';
        exportIter += 1;
        updateProgress();
    });
    
    linksSelection.forEach(id => {
        const link = document.getElementById(id);
        const clone = link.cloneNode(true);
        
        // Reset old positioning of clone
        clone.removeAttribute('transform');
        const x1 = parseFloat(link.getAttribute("x1"));
        const y1 = parseFloat(link.getAttribute("y1"));
        const x2 = parseFloat(link.getAttribute("x2"));
        const y2 = parseFloat(link.getAttribute("y2"));

        // Move the link relative to extract
        clone.setAttribute('x1', x1 - centerX - minX + 5);
        clone.setAttribute('y1', y1 - centerY + maxY + 5);
        clone.setAttribute('x2', x2 - centerX - minX + 5);
        clone.setAttribute('y2', y2 - centerY + maxY + 5); 
        
        extract.appendChild(clone);
        clone.style.display = 'block';

        const computedStyle = window.getComputedStyle(clone);
        clone.setAttribute("stroke-width", computedStyle.strokeWidth);   
        
        if (linkState === 1) {
            clone.style.stroke = '#379be7'
        } else if (linkState === 2) {
            clone.style.display = 'none';
        } else {
            const node1Color = document.getElementById(clone.getAttribute('Node1')).getAttribute("color");
            const node2Color = document.getElementById(clone.getAttribute('Node2')).getAttribute("color");
            if(node1Color === node2Color) {
                clone.style.stroke = node1Color;
            } else {
                replaceGradientWithSegments(clone, node1Color, node2Color, 1000);
            }         
        }
        exportIter += 1;
        updateProgress();
    });


    for (const node of nodesSelection) {
        const clone = node.cloneNode(true);
        clone.id = 'Clone_'+node.id;
        var event = new Event('change');
        const x = parseFloat(clone.children[0].getAttribute("x"));
        const y = parseFloat(clone.children[0].getAttribute("y"));
        const width = parseFloat(clone.children[0].getAttribute("width"));
        const height = parseFloat(clone.children[0].getAttribute("height"))
        const cloneX = parseFloat(node.getAttribute('x'));
        const cloneY = parseFloat(node.getAttribute('y'));
        const computedStyle = window.getComputedStyle(clone.children[1]);
        if (node.getAttribute('transparent') === '1') {
            clone.children[1].setAttribute("stroke", 'transparent');
        } else {
            clone.children[1].setAttribute("stroke", computedStyle.stroke);
            clone.children[1].setAttribute("stroke-width", computedStyle.strokeWidth) 
        }   
        // Reset old positioning of clone
        clone.removeAttribute('x');  
        clone.removeAttribute('y');  
        clone.removeAttribute('transform');
        // Move clone relative to extract
        const transfoX = -centerX + cloneX - minX + 5;
        const transfoY = -centerY - cloneY + maxY + 5;
        clone.setAttribute('transform', `translate(${(transfoX)}, ${(transfoY)})`); 
        clone.setAttribute('x',+cloneX-minX);  
        clone.setAttribute('y',-cloneY+maxY); 
        extract.appendChild(clone); 
        clone.style.display = 'block';

        for (let i = clone.children.length - 1; i >= 0; i--) {
            if (i > 2) {
                clone.removeChild(clone.children[i]); 
            }
        }  

        if (node.getAttribute('type') === 'video' || node.getAttribute('type') === 'file'){
            node.children[0].children[0].innerHTML = node.getAttribute('textcontent');
            if (node.getAttribute('type') === 'video') {
                node.children[7].children[0].children[0].value = 'video'; 
            } else {
                node.children[7].children[0].children[0].value = 'file'; 
            }            
            node.children[7].children[0].children[0].dispatchEvent(event); 
            
            const imageElem = document.createElementNS("http://www.w3.org/2000/svg", "image");
            imageElem.setAttribute("x", x + width/2 - 20);
            imageElem.setAttribute("y", y - 40);
            imageElem.setAttribute("width", 40);
            imageElem.setAttribute("height", 40);
            if (node.getAttribute('type') === 'video') {
                imageElem.setAttributeNS("http://www.w3.org/1999/xlink", "href", "/static/img/youtube-logo.png");
                const videoLink = clone.getAttribute("videolink") || "#";   
                clone.setAttribute('href','https://www.youtube.com/watch?'+videoLink);
            } else {
                imageElem.setAttributeNS("http://www.w3.org/1999/xlink", "href", "/static/img/file.png"); 
                const filename = clone.getAttribute('filename');
                const node_id = parseInt(node.id.match(/\d+/)[0], 10);
                setDownloadLink(node_id, filename, clone);
            }             
            clone.appendChild(imageElem);   
            
            clone.setAttribute('type','text');
        }                
        
        if(clone.getAttribute('type') === 'text'){
            for (let j = clone.children[0].children.length - 1; j >= 0; j--) {
                if (j !== 0) {
                    clone.children[0].removeChild(clone.children[0].children[j]); 
                }
            }
            await captureForeignObject(clone);

        } else if (clone.getAttribute('type') === 'image'){
            for (let j = clone.children[0].children.length - 1; j >= 0; j--) {
                if (j !== 1) {
                    clone.children[0].removeChild(clone.children[0].children[j]); 
                }
            }
            const image = clone.children[0].children[0];
            const imageElem = document.createElementNS("http://www.w3.org/2000/svg", "image");
            imageElem.setAttribute("x", x);
            imageElem.setAttribute("y", y);
            imageElem.setAttribute("width", width);
            imageElem.setAttribute("height", height);
            imageElem.setAttribute("href", image.src);
            clone.replaceChild(imageElem, clone.children[0]);
            exportIter += 1;
            updateProgress();

        } else if (clone.getAttribute('type') === 'canvas'){
            for (let j = clone.children[0].children.length - 1; j >= 0; j--) {
                if (j !== 4) {
                    clone.children[0].removeChild(clone.children[0].children[j]); 
                }
            }
            const canvas = clone.children[0].children[0];            
            const trimmedCanvas = document.createElement("canvas");
            trimmedCanvas.width = width;
            trimmedCanvas.height = height;
            clone.children[0].replaceChild(trimmedCanvas, canvas);
            var drawingDataString = clone.getAttribute('canvascontent');
            // Parse the string back into an array of objects
            var drawingData = JSON.parse(drawingDataString);  
            trimmedCanvas.setAttribute('id', 'Clone_'+canvas.getAttribute('id'));  
            dark = false;         
            redrawCanvas(trimmedCanvas.id,0, drawingData);
            dark = true;
            const dataURL = trimmedCanvas.toDataURL("image/png");
            const imageElem = document.createElementNS("http://www.w3.org/2000/svg", "image");
            imageElem.setAttribute("x", x);
            imageElem.setAttribute("y", y);
            imageElem.setAttribute("width", width);
            imageElem.setAttribute("height", height);
            imageElem.setAttribute("href", dataURL);           
            clone.replaceChild(imageElem, clone.children[0]);
            exportIter += 1;
            updateProgress();
        } 
    }
}


async function setDownloadLink(node_id, filename, clone) {
    const fileLink = await fileDownloadLink(node_id, filename);
    if (fileLink) {
        clone.setAttribute("href", fileLink);
    }
}

async function fileDownloadLink(node_id, filename) {
    try {
        const response = await fetch(`/generate-download-link/${node_id}/${filename}/`);
        if (!response.ok) {
            throw new Error(`Error: ${response.status}`);
        }
        const data = await response.json();
        return data.download_url;
    } catch (error) {
        console.error("Failed to generate download link:", error);
        return null;  // Return null in case of error
    }
}

function replaceGradientWithSegments(clone, startColor, endColor, segments = 10) {
    // Get the line coordinates
    const x1 = parseFloat(clone.getAttribute('x1') || 0);
    const y1 = parseFloat(clone.getAttribute('y1') || 0);
    const x2 = parseFloat(clone.getAttribute('x2') || 0);
    const y2 = parseFloat(clone.getAttribute('y2') || 0);
  
    // Convert HSL or HEX to RGB
    if (startColor.startsWith("#")) {
        startColor = hexToRgb(startColor);  
    } else if (startColor.startsWith("hsl")) {
        startColor = hslToRgb(startColor);  
    }
    if (endColor.startsWith("#")) {
        endColor = hexToRgb(endColor);  
    } else if (endColor.startsWith("hsl")) {
        endColor = hslToRgb(endColor);  
    }

    colors = [];    
    for (let i = 0; i < segments; i++) {
    const ratio = i / (segments - 1);
    const r = Math.round(startColor[0] + (endColor[0] - startColor[0]) * ratio);
    const g = Math.round(startColor[1] + (endColor[1] - startColor[1]) * ratio);
    const b = Math.round(startColor[2] + (endColor[2] - startColor[2]) * ratio);
    colors.push(`rgb(${r}, ${g}, ${b})`);
    }
    
    // Create an array to hold our new line segments
    const lineSegments = [];
    
    // Create each segment
    for (let i = 0; i < segments; i++) {
      const startRatio = i / segments;
      const endRatio = (i + 1) / segments;
      
      // Calculate the segment's start and end points
      const startX = x1 + (x2 - x1) * startRatio;
      const startY = y1 + (y2 - y1) * startRatio;
      const endX = x1 + (x2 - x1) * endRatio;
      const endY = y1 + (y2 - y1) * endRatio;
      
      // Create a new line segment
      const segment = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      
      // Set the coordinates
      segment.setAttribute('x1', startX);
      segment.setAttribute('y1', startY);
      segment.setAttribute('x2', endX);
      segment.setAttribute('y2', endY);
      
      // Set the color for this segment
      segment.style.stroke = colors[i];
      
      // Copy other important styles from the original
      segment.style.strokeWidth = 3+'px';    
      segment.style.display = 'block';  
      segment.style.opacity = 1;  
      // Add to our result array
      lineSegments.push(segment);
    }
    
    // If the clone has a parent, we can replace it
    if (clone.parentNode) {
      // First insert all new segments
      lineSegments.forEach(segment => {
        clone.parentNode.appendChild(segment);
      });
      // Then remove the original
      clone.parentNode.removeChild(clone);
    }
}

function hslToRgb(hslString) {
    // Step 1: Extract H, S, and L from the hsl() string
    const regex = /^hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)$/;
    const match = hslString.match(regex);
    if (!match) {
        throw new Error('Invalid HSL format');
    }
    const h = parseInt(match[1], 10); // Hue
    const s = parseInt(match[2], 10); // Saturation
    const l = parseInt(match[3], 10); // Lightness

    // Step 2: Convert HSL to RGB
    const hue = h / 360; // Normalize hue to [0, 1]
    const saturation = s / 100; // Normalize saturation to [0, 1]
    const lightness = l / 100; // Normalize lightness to [0, 1]

    let r, g, b;

    // Achromatic (gray) case
    if (saturation === 0) {
        r = g = b = lightness; // All equal
    } else {
        const c = (1 - Math.abs(2 * lightness - 1)) * saturation; // Chroma
        const x = c * (1 - Math.abs((hue * 6) % 2 - 1)); // X value
        const m = lightness - c / 2; // Match value

        let rp, gp, bp;

        if (hue >= 0 && hue < 1 / 6) {
            rp = c; gp = x; bp = 0;
        } else if (hue >= 1 / 6 && hue < 2 / 6) {
            rp = x; gp = c; bp = 0;
        } else if (hue >= 2 / 6 && hue < 3 / 6) {
            rp = 0; gp = c; bp = x;
        } else if (hue >= 3 / 6 && hue < 4 / 6) {
            rp = 0; gp = x; bp = c;
        } else if (hue >= 4 / 6 && hue < 5 / 6) {
            rp = x; gp = 0; bp = c;
        } else {
            rp = c; gp = 0; bp = x;
        }

        r = (rp + m) * 255;
        g = (gp + m) * 255;
        b = (bp + m) * 255;
    }

    return [Math.round(r), Math.round(g), Math.round(b)];
}

function hexToRgb(hex) {
    // Remove the '#' if present
    hex = hex.replace(/^#/, '');

    // Check if it's a 6-digit hex code
    if (hex.length === 6) {
        // Parse the RGB components from the hex string
        const r = parseInt(hex.substr(0, 2), 16);
        const g = parseInt(hex.substr(2, 2), 16);
        const b = parseInt(hex.substr(4, 2), 16);
        return [r, g, b];
    }

    // Handle 3-digit hex codes (e.g., #RGB format)
    if (hex.length === 3) {
        const r = parseInt(hex.substr(0, 1) + hex.substr(0, 1), 16);
        const g = parseInt(hex.substr(1, 1) + hex.substr(1, 1), 16);
        const b = parseInt(hex.substr(2, 1) + hex.substr(2, 1), 16);
        return [r, g, b];
    }

    throw new Error('Invalid Hex format');
}

async function captureForeignObject(svgElement) {
    const foreignObj = svgElement.children[0];
    const htmlContent = foreignObj.innerHTML;

    // Create a temporary container for the HTML content
    const tempDiv = document.createElement("div");
    tempDiv.style.position = "absolute";
    tempDiv.style.whiteSpace = "normal"; // Ensure wrapping
    tempDiv.style.width = parseFloat(foreignObj.getAttribute('width')) + "px";
    tempDiv.style.height = "auto"; 
    tempDiv.style.zIndex = -1000;
    tempDiv.innerHTML = htmlContent;
    document.body.appendChild(tempDiv);
    const content = tempDiv.firstChild; 

    await html2canvas(content, {
        backgroundColor: null, 
        removeContainer: true,
        logging: false, 
        scale: window.devicePixelRatio * 7,  // Increase resolution
        useCORS: true, // Fix cross-origin images
    }).then(function (canvas) {
        // Once all foreignObjects are processed, download the image
        const dataURL = canvas.toDataURL("image/png");

        // Create an <image> element to replace the foreignObject
        const x = parseFloat(foreignObj.getAttribute("x"));
        const y = parseFloat(foreignObj.getAttribute("y"));
        const width = parseFloat(foreignObj.getAttribute("width"));
        const height = parseFloat(foreignObj.getAttribute("height"));
        const scrollheight = foreignObj.children[0].scrollHeight;

        const imageElem = document.createElementNS("http://www.w3.org/2000/svg", "image");
        imageElem.setAttribute("x", x);
        imageElem.setAttribute("y", y + height/2 - scrollheight/2);
        imageElem.setAttribute("width", width);
        imageElem.setAttribute("height", scrollheight);
        imageElem.setAttribute("href", dataURL);
        imageElem.setAttribute("preserveAspectRatio", "none");

        // Replace the foreignObject with the image
        foreignObj.parentNode.replaceChild(imageElem, foreignObj);
        // Clean up temporary elements
        document.body.removeChild(tempDiv);
        exportIter += 1;
        updateProgress();
    });  
}

async function exportSVGToPDF(svgElement, filename = 'Nod-Z.pdf') {
    // Get SVG dimensions
    const bbox = svgElement.getBBox();
    svgElement.setAttribute("transform", "scale(0.3)");
    const width = (bbox.width)*0.3 + 10;
    const height = (bbox.height)*0.3 + 10;

    const img = new Image(); 
    img.src = "/static/img/logo_img.png"; 
    const logoScale = 0.002*(width+height)/2;
    console.log(logoScale);
    const imgHeight = Math.max(49.5,49.5*logoScale);
    const imgWidth = Math.max(60,60*logoScale);
    
    // Create new jsPDF instance
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({
        unit: 'px',
        format: [width*1.2 + imgWidth, height*1.2 + imgHeight],
        orientation: width > height ? 'landscape' : 'portrait'
    });

    doc.addImage(img, "PNG", width*1.2 -20*Math.max(1,logoScale), 10*Math.max(1,logoScale), imgWidth, imgHeight); // x, y, width, height

    // Calculate scaling to fit on PDF page
    const pdfWidth = doc.internal.pageSize.getWidth();
    const pdfHeight = doc.internal.pageSize.getHeight();

    // Calculate centered position using scaled dimensions
    const centeredX = (pdfWidth - width) / 2;
    const centeredY = (pdfHeight - height) / 2 + imgHeight/2;
    
    try {
        // Convert SVG to PDF      
        await window.svg2pdf.svg2pdf(svgElement, doc, {
            x: centeredX, 
            y: centeredY,
            width: width/0.3,
            height: height/0.3,
            useCSS: true,
            preserveAspectRatio: 'xMidYMid meet',
        });

        const objects = svgElement.querySelectorAll('.node-group');
        objects.forEach(obj => {
            if (obj.getAttribute('href')) {             
                const X = parseFloat(obj.getAttribute('x'));
                const Y = parseFloat(obj.getAttribute('y'));   
                const href = obj.getAttribute('href'); 
                // Convert to PDF coordinates
                const pdfX = centeredX + X * 0.3;
                const pdfY = centeredY + Y * 0.3;
                const pdfWidth = parseFloat(obj.children[1].getAttribute('r'))*2*0.3;
                const pdfHeight = parseFloat(obj.children[1].getAttribute('r'))*2*0.3;
                doc.link(pdfX - pdfWidth/2 , pdfY - pdfHeight/2 , pdfWidth, pdfHeight, { url: href });
                // doc.setFillColor(255, 0, 0);  // Red color for testing
                // doc.rect(pdfX - pdfWidth/2 , pdfY - pdfHeight/2 , pdfWidth, pdfHeight, 'F'); // Debugging rect (remove later)
            }            
        });
        // Logo
        const nodz = window.location.href;
        doc.link(width*1.2 -20*Math.max(1,logoScale), 10*Math.max(1,logoScale), imgWidth, imgHeight, { url: nodz });

        // Save the PDF
        doc.save(filename);
    } catch (error) {
        console.error('Error converting SVG to PDF:', error);
    }
}


// Function to extract colors and stop points from an SVG gradient
function getGradientStops(gradientId) {
    const gradient = document.getElementById(gradientId); // Find the gradient element by ID
    const stops = gradient.querySelectorAll('stop');  // Get all <stop> elements within the gradient
    const colorStops = [];

    // Loop through each stop to extract the offset and color
    stops.forEach(stop => {
        const offset = parseInt(stop.getAttribute('offset'))/100;  // Get the offset (position) of the color stop
        const style = stop.getAttribute('style'); 
        const color = style.match(/stop-color:\s*([^;]+)/)[1];  // Get the color of the stop
        colorStops.push({ offset: parseFloat(offset), color: color });
    });

    return colorStops;
}



document.getElementById('export').addEventListener('mousedown', () => {
    event.preventDefault();
});

document.getElementById('export').addEventListener('contextmenu', () => {
    event.preventDefault();
});



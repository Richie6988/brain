//////////////////// DRAGGING SELECTED NODES ////////////////////

function dragSelected(dragX,dragY) {
    selectedLinks.length = 0;
    selectedNodes.forEach(nodeGroup => {
        if(nodeGroup.getAttribute('lock') === '0'){
            const transformAttr = nodeGroup.getAttribute('transform');
            const transformRegex = /translate\((-?\d+\.?\d*),\s*(-?\d+\.?\d*)\)\s*scale\((-?\d+\.?\d*)\)/;                          
            const match = transformAttr.match(transformRegex);
            const transfoX = parseFloat(match[1]);
            const transfoY = parseFloat(match[2]);

            nodeGroup.setAttribute('transform', `translate(${(dragX/currentZoom + transfoX).toFixed(5)}, ${(dragY/currentZoom + transfoY).toFixed(5)}) scale(${1})`);
            nodeGroup.setAttribute('x', parseFloat(nodeGroup.getAttribute('x')) + (dragX/currentZoom));
            nodeGroup.setAttribute('y', parseFloat(nodeGroup.getAttribute('y')) - (dragY/currentZoom));

            // Links

            var links = JSON.parse(nodeGroup.getAttribute('links'));
            links.forEach(id => {
                // Check if the ID is not already in the links array
                if (!selectedLinks.includes(id)) {
                    selectedLinks.push(id);
                }
            });
            selectedLinks.forEach(id => {
                const link = document.getElementById(id);
                updateLink(link)  
                if(linkState === 0){
                    updateLinkColor(link) 
                }                               
            }); 
        } 
    });    
    selectedTemplates.forEach(template => {
        const transformAttr = template.getAttribute('transform');
        const transformRegex = /translate\((-?\d+\.?\d*),\s*(-?\d+\.?\d*)\)\s*scale\((-?\d+\.?\d*)\)/;                          
        const match = transformAttr.match(transformRegex);
        const transfoX = parseFloat(match[1]);
        const transfoY = parseFloat(match[2]);
        const scale = parseFloat(match[3]);
        template.setAttribute('transform', `translate(${(dragX/currentZoom + transfoX).toFixed(5)}, ${(dragY/currentZoom + transfoY).toFixed(5)}) scale(${scale})`);
        template.setAttribute('x', parseFloat(template.getAttribute('x')) + (dragX/currentZoom));
        template.setAttribute('y', parseFloat(template.getAttribute('y')) - (dragY/currentZoom));
    });
    dispatcher();
}


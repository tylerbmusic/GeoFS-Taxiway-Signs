// ==UserScript==
// @name         GeoFS Taxiway Signs
// @version      0.3
// @description  Adds taxiway sign board things
// @author       GGamerGGuy
// @match        https://geo-fs.com/geofs.php*
// @match        https://*.geo-fs.com/geofs.php*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=geo-fs.com
// @grant        none
// ==/UserScript==
const workerScript = () => {
    //This function was written by AI
    function calculateAngle(p1, p2, p3) {
        if (p1 && p2 && p3) {
            const dx1 = p2[1] - p1[1];
            const dy1 = p2[0] - p1[0];
            const dx2 = p3[1] - p2[1];
            const dy2 = p3[0] - p2[0];

            const mag1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
            const mag2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);

            if (mag1 === 0 || mag2 === 0) {
                return null; // Return null if vectors are zero-length
            }

            let cosineAngle = (dx1 * dx2 + dy1 * dy2) / (mag1 * mag2);
            cosineAngle = Math.min(1, Math.max(-1, cosineAngle)); // Clamp to [-1, 1]

            const angle = Math.acos(cosineAngle);
            return angle * (180 / Math.PI); // Convert to degrees
        }
        return null; // Default return value if points are missing
    }
    //This function was partially written with AI.
    async function getTwMData(bounds) {
        const bbox = bounds;
        const overpassUrl = 'https://overpass-api.de/api/interpreter';
        const query = `[out:json];
        (
            way["aeroway"="taxiway"]({{bbox}})[ref];
            way["aeroway"="runway"]({{bbox}})[ref];
        );
        out body;
        >;
        out skel qt;
    `;

        try {
            const response = await fetch(`${overpassUrl}?data=${encodeURIComponent(query.replaceAll('{{bbox}}', bbox))}`);
            const data = await response.json();
            console.log(data);
            return data;
        } catch (error) {
            console.log(error);
        }
    }
    async function getTwM(bounds, twSAngle) {
        var theNodes;
        var theWays = {};
        getTwMData(bounds).then(twMD => {
            const nodeWays = {};
            const intersections = [];
            const nodes = [];
            twMD.elements.forEach(e => { //e=element
                if (e.type == 'node') {
                    nodes[e.id] = [e.lat, e.lon];
                }
            });
            theNodes = nodes;

            // Collect the taxiway names for each node
            twMD.elements.forEach(element => {
                if (element.type === 'way' && element.tags && element.tags.ref) {
                    const taxiwayName = element.tags.ref;
                    console.log([element.tags.ref, element.nodes]);
                    theWays[element.tags.ref] = element.nodes;
                    element.nodes.forEach(nodeId => {
                        if (!nodeWays[nodeId]) {
                            nodeWays[nodeId] = new Set();
                        }
                        nodeWays[nodeId].add(taxiwayName);
                    });
                }
            });
            var toFilter = [];
            // Function to filter out nodes based on angles
            for (let w in theWays) {
                let toFilter = [];

                for (let n = theWays[w].length - 2; n > 0; n--) {
                    let angle = calculateAngle(theNodes[theWays[w][n - 1]], theNodes[theWays[w][n]], theNodes[theWays[w][n + 1]]);

                    // Adjust threshold if needed
                    if (angle > Number(twSAngle) && angle < 40) { //LocSt twSAngle
                        toFilter.push(n);
                    } else {
                        console.log(`Skipped node ${n} with angle: ${angle}`); // Debug: log skipped nodes
                    }
                }

                // Remove nodes in reverse to avoid index shift
                for (let i = toFilter.length - 1; i >= 0; i--) {
                    let index = toFilter[i];
                    console.log(`Removing node ${index} with angle: ${calculateAngle(theNodes[theWays[w][index - 1]], theNodes[theWays[w][index]], theNodes[theWays[w][index + 1]])}`); // Debug: log removed nodes
                    theWays[w].splice(index, 1);
                }
            }


            // Filter nodes that are intersections (appear in multiple ways)
            twMD.elements.forEach(element => {
                if (element.type === 'node' && nodeWays[element.id] && nodeWays[element.id].size > 1) {
                    const intersectingTaxiways = Array.from(nodeWays[element.id]).join(" ");
                    intersections.push([element.lat, element.lon, intersectingTaxiways, element.id]);
                }
            });
            var twSize = 0;
            for (var i in twMD.elements) {
                if (twMD.elements[i].type == 'way' && twMD.elements[i].tags.aeroway == 'runway' && twMD.elements[i].tags.width && Number(twMD.elements[i].tags.width) > twSize) {
                    twSize = Number(twMD.elements[i].tags.width);
                }
            }
            if (twSize == 0) {
                console.log("twSize == 0");
                twSize = 45;
            }
            const theData = {data: intersections, theNodes: theNodes, theWays: theWays, twSize: twSize};
            self.postMessage({type: "getTwM", data: theData});
        });
    }
    self.addEventListener('message', function(event) {
        if (event.data.type == 'getTwM') {
            getTwM(event.data.data[0], event.data.data[1]);
        }
    });
};
(function() {
    'use strict';
    window.twM = [];
    window.twS = [];
    window.theWays = [];
    window.theNodes = [];
    window.twSPos = [];
    window.twSOri = [];
    window.twSignWorker = new Worker(URL.createObjectURL(new Blob([`(${workerScript})()`], { type: 'application/javascript' })));
    window.twSignWorker.addEventListener('message', function(event) {
        if (event.data.type == 'getTwM' && (localStorage.getItem("twSEnabled") == "true")) {
            window.theWays = event.data.data.theWays;
            window.theNodes = event.data.data.theNodes;
            window.twSize = event.data.data.twSize / 3;
            window.setTwM(event.data.data.data); //That's a lot of data!
        } else if (event.data.type == 'testLabel') {
            var pos = event.data.data.pos;
            window.geofs.api.viewer.entities.add({
                position: window.Cesium.Cartesian3.fromDegrees(pos[0], pos[1], window.geofs.api.viewer.scene.globe.getHeight(window.Cesium.Cartographic.fromDegrees(pos[0], pos[1]))),
                label: {
                    text: event.data.data.text
                }
            });
        }
    });
    if (!window.gmenu || !window.GMenu) {
        fetch('https://raw.githubusercontent.com/tylerbmusic/GeoFS-Addon-Menu/refs/heads/main/addonMenu.js')
            .then(response => response.text())
            .then(script => {eval(script);})
            .then(() => {setTimeout(afterGMenu, 100);});
    }
    function afterGMenu() {
        const twSM = new window.GMenu("Taxiway Signs", "twS");
        twSM.addItem("Render distance (degrees): ", "RenderDist", "number", 0, 0.05);
        twSM.addItem("Update Interval (seconds): ", "UpdateInterval", "number", 0, 4);
        twSM.addItem("Filter Angle (Filters taxiway points greater than the specified angle): ", "Angle", "number", 0, 1);
        //twSM.addItem("desc", "ls", "type", 0, "defaultValue");
        setInterval(() => {window.updateMarkers();}, 1000*Number(localStorage.getItem("twSUpdateInterval"))); //LocSt twSUpdateInterval
    }
})();
window.updateMarkers = async function() {
    if (window.geofs.cautiousWithTerrain == false) {
        var renderDistance = Number(localStorage.getItem("twSRenderDist")); //Render distance, in degrees. //LocSt twSRenderDist
        var l0 = Math.floor(window.geofs.aircraft.instance.llaLocation[0]/renderDistance)*renderDistance;
        var l1 = Math.floor(window.geofs.aircraft.instance.llaLocation[1]/renderDistance)*renderDistance;
        var bounds = (l0) + ", " + (l1) + ", " + (l0+renderDistance) + ", " + (l1+renderDistance);
        if (!window.MLastBounds || (window.MLastBounds != bounds)) {
            //Remove existing markers
            for (let i = 0; i < window.twM.length; i++) {
                window.geofs.api.viewer.scene.primitives.remove(window.twM[i]);
            }
            for (let i in window.twS) {
                window.geofs.api.viewer.scene.primitives.remove(window.twS[i]);
            }
            window.twM = [];
            window.twS = [];
            window.theWays = [];
            window.theNodes = [];
            console.log("Markers removed, placing new ones");
            //Place new markers
            window.twSignWorker.postMessage({type: "getTwM", data: [bounds, localStorage.getItem("twSAngle")]});
        }
        window.MLastBounds = bounds;
    }
}
function offsetCoordinate(coord, angle, offsetDistance) {
    const [lat, lon, int, id] = coord;
    const earthRadius = 6371000; // Earth radius in meters

    const offsetLat = lat + (offsetDistance / earthRadius) * (180 / Math.PI) * Math.cos(angle);
    const offsetLon = lon + (offsetDistance / earthRadius) * (180 / Math.PI) * Math.sin(angle) / Math.cos(lat * Math.PI / 180);

    return [offsetLat, offsetLon];
}
window.setTwM = async function(intersections) {
    var heading = 0; //HEADING IS IN RADIANS!
    console.log(intersections);
    intersections.forEach(epos => {
        //heading = Math.atan2(segmentEnd[1] - segmentStart[1], segmentEnd[0] - segmentStart[0]);
        const splitTw = epos[2].split(" ");
        for (var hFlip = 0; hFlip <= 1; hFlip++) { //headingFlip, in a couple of years I will hate myself for naming variables like this
            for (var sTw = 0; sTw < splitTw.length; sTw++) { //splitTaxiway
                const twNodeIds = window.theWays[splitTw[sTw]];
                var twArr = splitTw;
                var twP = twArr.splice(sTw, 1)[0];
                twArr.unshift(twP);
                var twStr = twArr.join(" ");
                var hNode;
                var notReversed = true;
                var twBothWays = true;
                for (var i = 0; i < twNodeIds.length; i++) {
                    if (twNodeIds[i] < epos[3] /*&& i == 0*/) { //Logic to handle if the sign is at the start of a taxiway
                        hNode = window.theNodes[twNodeIds[i]];
                        notReversed = false;
                        break;
                    } else if (twNodeIds[i] > epos[3]) { //If the taxiway continues in the opposite direction, use that node.
                        hNode = window.theNodes[twNodeIds[i]];
                        break;
                    }
                }
                for (var z = 0; z < twNodeIds.length; z++) {
                    if (twNodeIds[z] == epos[3] && (z == twNodeIds.length - 1 || z == 0)) {
                        twBothWays = false;
                    }
                }
                if (!hNode && twNodeIds.length == 2) {
                    hNode = window.theNodes[twNodeIds[0]];
                }
                if (hNode) {
                    heading = notReversed ? (Math.atan2(epos[1] - hNode[1], epos[0] - hNode[0])) : ((Math.atan2(epos[1] - hNode[1], epos[0] - hNode[0])) - Math.PI);
                }
                if (hFlip) {
                    heading -= Math.PI;
                }
                const tpos = offsetCoordinate(epos, (heading+45) - (Math.PI / 2), window.twSize); //Offset it 15 meters to the right
                const apos = [tpos[1], tpos[0], window.geofs.api.viewer.scene.globe.getHeight(window.Cesium.Cartographic.fromDegrees(tpos[1], tpos[0]))];
                const pos = window.Cesium.Cartesian3.fromDegrees(apos[0], apos[1], apos[2]);
                const hpr = new window.Cesium.HeadingPitchRoll(heading, 0, 0);
                const ori = window.Cesium.Transforms.headingPitchRollQuaternion(pos, hpr);

                // Step 1: Create the canvas texture with the taxiway text
                const canvas = document.createElement('canvas');
                canvas.width = 300;
                canvas.height = 100;
                const context = canvas.getContext('2d');

                // Split twStr into words and style the first word
                const words = twStr.split(" ");
                const firstWord = words[0];
                var remainingText = words.slice(1).join(" ");
                var intRunway = false; //intersectionRunway, boolean determining if the intersection HAS a runway
                var isRunway = false; //isRunway, boolean determining if the intersection IS a runway
                if (remainingText.includes("/")) {
                    intRunway = true;
                } else if (firstWord.includes("/")) {
                    isRunway = true;
                }
                if (twBothWays) {
                    remainingText += '↔'
                } else {
                    remainingText += hFlip ? '←' : '→';
                }

                // Draw the yellow background for the entire canvas
                context.fillStyle = intRunway ? 'red' : 'yellow';
                context.fillRect(0, 0, canvas.width, canvas.height);

                // Set font style for the text
                context.font = intRunway ? '600 60px sans-serif' : '600 40px sans-serif';
                context.textAlign = 'center';
                context.textBaseline = 'middle';

                if (!intRunway && !isRunway) {
                    // Calculate positioning for the text
                    const textY = canvas.height / 2;
                    const textPadding = 10;
                    const firstWordWidth = context.measureText(firstWord).width;
                    const remainingTextWidth = context.measureText(remainingText).width;
                    const totalWidth = firstWordWidth + textPadding + remainingTextWidth;

                    // Draw a black rectangle behind the first word
                    context.fillStyle = 'black';
                    context.fillRect((canvas.width - totalWidth) / 2, textY - 30, firstWordWidth + textPadding, 60);

                    // Draw the first word with yellow text
                    context.fillStyle = 'yellow';
                    context.fillText(firstWord, (canvas.width - totalWidth) / 2 + firstWordWidth / 2, textY);

                    // Draw remaining text in black
                    context.fillStyle = 'black';
                    context.fillText(remainingText, (canvas.width + firstWordWidth) / 2 + textPadding, textY);
                } else if (intRunway) {
                    context.fillStyle = 'white';
                    const textY = canvas.height / 2;
                    context.fillText(remainingText, (canvas.width / 2), (canvas.height / 2));
                } else {
                    context.fillStyle = 'black';
                    context.fillText(remainingText, (canvas.width / 2), (canvas.height / 2));
                }

                const imageUrl = canvas.toDataURL();


                /*Step 1.5 (DEBUGGING): Add a blue light to indicate the direction the taxiway sign should be facing.
                if (hNode) {
                    const aposD = [hNode[1], hNode[0], window.geofs.api.viewer.scene.globe.getHeight(window.Cesium.Cartographic.fromDegrees(hNode[1], hNode[0]))];
                    const posD = window.Cesium.Cartesian3.fromDegrees(aposD[0], aposD[1], aposD[2]);
                    window.geofs.api.viewer.entities.add({
                        position: posD,
                        billboard: {
                            image: "https://tylerbmusic.github.io/GPWS-files_geofs/bluelight.png",
                            scale: 0.5 * (1 / window.geofs.api.renderingSettings.resolutionScale),
                        },
                    });
                }*/

                // Step 2: Place the main sign model without text
                window.twSPos.push(pos);
                window.twSOri.push(ori);

                // Step 3: Define position, rotation, and scale adjustments for the plane
                const translationMatrix = window.Cesium.Matrix4.fromTranslation(new window.Cesium.Cartesian3(0, 0.17, 0.8));
                const rotationMatrix = window.Cesium.Matrix4.fromRotationTranslation(window.Cesium.Matrix3.fromRotationX(window.Cesium.Math.toRadians(90)), window.Cesium.Cartesian3.ZERO);
                const scaleMatrix = window.Cesium.Matrix4.fromScale(new window.Cesium.Cartesian3(-1.9, 0.9, 1));

                // Combine transformations
                let transformMatrix = new window.Cesium.Matrix4();
                window.Cesium.Matrix4.multiplyTransformation(translationMatrix, rotationMatrix, transformMatrix);
                window.Cesium.Matrix4.multiplyTransformation(transformMatrix, scaleMatrix, transformMatrix);

                // Final model matrix
                const modelMatrix = window.Cesium.Transforms.headingPitchRollToFixedFrame(pos, hpr);
                window.Cesium.Matrix4.multiplyTransformation(modelMatrix, transformMatrix, modelMatrix);

                // Step 4: Create a textured plane as a Primitive with orientation
                const texturedPlane = new window.Cesium.Primitive({
                    geometryInstances: new window.Cesium.GeometryInstance({
                        geometry: new window.Cesium.PlaneGeometry({
                            vertexFormat: window.Cesium.VertexFormat.TEXTURED,
                            width: 5, // Adjust to fit the texture better
                            height: 2 // Adjust to fit the texture better
                        }),
                        modelMatrix: modelMatrix
                    }),
                    appearance: new window.Cesium.MaterialAppearance({
                        material: window.Cesium.Material.fromType('Image', {
                            image: imageUrl
                        }),
                    })
                });

                // Step 5: Add the primitive to the scene
                window.twS.push(window.geofs.api.viewer.scene.primitives.add(texturedPlane));
            }
        }
    });
    instanceTwS();
};
async function instanceTwS() {
    const modelMatrices = window.twSPos.map((position, index) => {
        const translationMatrix = /*window.Cesium.Transforms.northEastDownToFixedFrame*/window.Cesium.Matrix4.fromTranslation(position);

        // Convert quaternion to rotation matrix
        const rotationMatrix = window.Cesium.Matrix3.fromQuaternion(window.twSOri[index]);

        // Apply rotation to translation
        return window.Cesium.Matrix4.multiplyByMatrix3(translationMatrix, rotationMatrix, new window.Cesium.Matrix4());
    });
    window.twM.push(window.geofs.api.viewer.scene.primitives.add(
        new window.Cesium.ModelInstanceCollection({
            url: "https://raw.githubusercontent.com/tylerbmusic/GPWS-files_geofs/refs/heads/main/tw_sign.glb",
            minimumPixelSize: 32,
            maximumScale: 1,
            instances: modelMatrices.map((matrix) => ({ modelMatrix: matrix })),
        })));
}

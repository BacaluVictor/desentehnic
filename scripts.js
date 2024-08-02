(function() {
  const canvas = document.getElementById('drawingCanvas');
  const ctx = canvas.getContext('2d');

  // A4 dimensions in mm
  const A4_WIDTH = 210;
  const A4_HEIGHT = 297;

  // Scale factor (adjust this to fit the canvas on the screen)
  const SCALE = 3;

  let isPortrait = true;
  let GRID_SIZE = 10; // Default grid size in mm
  let DEFAULT_LINE_THICKNESS = 0.5; // Default line thickness in mm

  let lines = [];
  let dimensions = [];
  let texts = [];
  let selectedElements = [];
  let currentLine = null;
  let startPoint = null;
  let tool = 'line';
  let measureUnit = 'mm';
  let isMoving = false;
  let moveOffset = { x: 0, y: 0 };

  let undoStack = [];
  let redoStack = [];

  let hoveredElement = null;
  let manualDimensionPoints = [];
  let previewDimension = null;

  let snapPoints = [];
  let showSymmetryAxes = false;
  let cotaStyle = {
    color: 'red',
    font: '12px Arial',
    arrowType: 'arrow'
  };

  let isErasing = false;
  let eraserSize = 10;

  let textStartPoint = null;
  let currentText = '';
  let isAddingText = false;
  let isEditingText = false;
  let editingTextId = null;

  let isEditingDimension = false;
  let editingDimension = null;

  function updateCanvasSize() {
    canvas.width = isPortrait ? A4_WIDTH * SCALE : A4_HEIGHT * SCALE;
    canvas.height = isPortrait ? A4_HEIGHT * SCALE : A4_WIDTH * SCALE;
  }

  function mmToPixels(mm) {
    return mm * SCALE;
  }

  function pixelsToMm(pixels) {
    return pixels / SCALE;
  }

  function snapToGrid(x, y) {
    const gridSizePixels = mmToPixels(GRID_SIZE);
    return [
      Math.round(x / gridSizePixels) * gridSizePixels,
      Math.round(y / gridSizePixels) * gridSizePixels
    ];
  }

  function distanceToLine(x, y, x1, y1, x2, y2) {
    const A = x - x1;
    const B = y - y1;
    const C = x2 - x1;
    const D = y2 - y1;

    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    let param = -1;
    if (lenSq !== 0) param = dot / lenSq;

    let xx, yy;

    if (param < 0) {
      xx = x1;
      yy = y1;
    } else if (param > 1) {
      xx = x2;
      yy = y2;
    } else {
      xx = x1 + param * C;
      yy = y1 + param * D;
    }

    const dx = x - xx;
    const dy = y - yy;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function updateSnapPoints() {
    snapPoints = [];
    lines.forEach(line => {
      snapPoints.push(line.start, line.end, {
        x: (line.start.x + line.end.x) / 2,
        y: (line.start.y + line.end.y) / 2
      });
    });
  }

  function snapToPoint(x, y) {
    const snapDistance = mmToPixels(2);
    for (let point of snapPoints) {
      if (Math.abs(x - point.x) < snapDistance && Math.abs(y - point.y) < snapDistance) {
        return [point.x, point.y];
      }
    }
    return snapToGrid(x, y);
  }

  function startDrawing(e) {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const [snappedX, snappedY] = snapToPoint(x, y);

    if (tool === 'eraser') {
      startErasing(e);
    } else if (tool === 'line') {
      startPoint = { x: snappedX, y: snappedY };
    } else if (tool === 'select') {
      selectElement(x, y, e.ctrlKey);
    } else if (tool === 'move' && selectedElements.length > 0) {
      isMoving = true;
      moveOffset = {
        x: snappedX - selectedElements[0].start.x,
        y: snappedY - selectedElements[0].start.y
      };
    } else if (tool === 'manualDimension') {
      manualDimensionPoints.push({ x: snappedX, y: snappedY });
      if (manualDimensionPoints.length === 2) {
        addManualDimension();
      }
    } else if (tool === 'text') {
      startDrawingText(e);
    }
  }

  function draw(e) {
    const rect = canvas.getBoundingClientRect();
    let x = e.clientX - rect.left;
    let y = e.clientY - rect.top;
    let [snappedX, snappedY] = snapToPoint(x, y);

    if (tool === 'eraser' && isErasing) {
      eraseAt(e);
    } else if (tool === 'line' && startPoint) {
      currentLine = { 
        type: 'line',
        start: startPoint, 
        end: { x: snappedX, y: snappedY },
        thickness: DEFAULT_LINE_THICKNESS
      };
    } else if (tool === 'select' && startPoint) {
      drawSelectionRect(startPoint, { x: snappedX, y: snappedY });
    } else if (tool === 'move' && isMoving) {
      const [snappedDX, snappedDY] = snapToPoint(
        snappedX - moveOffset.x, 
        snappedY - moveOffset.y
      );
      moveElements(snappedDX - selectedElements[0].start.x, snappedDY - selectedElements[0].start.y);
    } else if (tool === 'manualDimension' && manualDimensionPoints.length === 1) {
      previewDimension = {
        start: manualDimensionPoints[0],
        end: { x: snappedX, y: snappedY }
      };
    } else if (isEditingDimension) {
      handleDimensionEdit(e);
    }
    drawCanvas();
  }

  function endDrawing() {
    if (tool === 'eraser') {
      stopErasing();
    } else if (tool === 'line' && currentLine) {
      saveState();
      lines.push(currentLine);
      currentLine = null;
      startPoint = null;
      updateSnapPoints();
    } else if (tool === 'select' && startPoint) {
      selectElementsInRect(startPoint, { x: event.clientX - canvas.getBoundingClientRect().left, y: event.clientY - canvas.getBoundingClientRect().top });
      startPoint = null;
    } else if (tool === 'move') {
      if (isMoving) {
        saveState();
      }
      isMoving = false;
    } else if (isEditingDimension) {
      isEditingDimension = false;
      editingDimension = null;
      saveState();
    }
    drawCanvas();
  }

  function setLineLength() {
    const length = parseFloat(document.getElementById('lineLength').value);
    if (currentLine && !isNaN(length)) {
      const angle = Math.atan2(currentLine.end.y - currentLine.start.y, currentLine.end.x - currentLine.start.x);
      currentLine.end.x = currentLine.start.x + Math.cos(angle) * mmToPixels(length);
      currentLine.end.y = currentLine.start.y + Math.sin(angle) * mmToPixels(length);
      drawCanvas();
    }
  }

  function drawSelectionRect(start, end) {
    ctx.strokeStyle = 'blue';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y);
    ctx.setLineDash([]);
  }

  function selectElement(x, y, isMultiSelect) {
    const clickedElement = [...lines, ...dimensions, ...texts].find(elem => 
      distanceToLine(x, y, elem.start.x, elem.start.y, elem.end.x, elem.end.y) < mmToPixels(2)
    );
    
    if (clickedElement) {
      if (isMultiSelect) {
        const index = selectedElements.indexOf(clickedElement);
        if (index > -1) {
          selectedElements.splice(index, 1);
        } else {
          selectedElements.push(clickedElement);
        }
      } else {
        selectedElements = [clickedElement];
      }

      if (clickedElement.type === 'dimension') {
        startEditingDimension(clickedElement);
      } else if (clickedElement.type === 'text') {
        editText(clickedElement);
      }
    } else if (!isMultiSelect) {
      selectedElements = [];
    }
    
    drawCanvas();
  }

  function selectElementsInRect(start, end) {
    const allElements = [...lines, ...dimensions, ...texts];
    selectedElements = allElements.filter(elem => 
      isElementInRect(elem, start, end)
    );
    drawCanvas();
  }

  function isElementInRect(elem, start, end) {
    const minX = Math.min(start.x, end.x);
    const maxX = Math.max(start.x, end.x);
    const minY = Math.min(start.y, end.y);
    const maxY = Math.max(start.y, end.y);

    return (elem.start.x >= minX && elem.start.x <= maxX &&
            elem.start.y >= minY && elem.start.y <= maxY &&
            elem.end.x >= minX && elem.end.x <= maxX &&
            elem.end.y >= minY && elem.end.y <= maxY);
  }

  function moveElements(dx, dy) {
    selectedElements.forEach(elem => {
      elem.start.x += dx;
      elem.start.y += dy;
      elem.end.x += dx;
      elem.end.y += dy;
      if (elem.type === 'dimension') {
        elem.refStart.x += dx;
        elem.refStart.y += dy;
        elem.refEnd.x += dx;
        elem.refEnd.y += dy;
      } else if (elem.type === 'text') {
        elem.x += dx;
        elem.y += dy;
      }
    });
  }

  function rotateElements() {
    if (selectedElements.length > 0) {
      const center = getSelectionCenter();
      selectedElements.forEach(elem => {
        rotatePoint(elem.start, center, 5 * (Math.PI / 180));
        rotatePoint(elem.end, center, 5 * (Math.PI / 180));
        if (elem.type === 'dimension') {
          rotatePoint(elem.refStart, center, 5 * (Math.PI / 180));
          rotatePoint(elem.refEnd, center, 5 * (Math.PI / 180));
        } else if (elem.type === 'text') {
          rotatePoint(elem, center, 5 * (Math.PI / 180));
        }
      });
      saveState();
      drawCanvas();
    }
  }

  function getSelectionCenter() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    selectedElements.forEach(elem => {
      if (elem.type === 'text') {
        minX = Math.min(minX, elem.x);
        minY = Math.min(minY, elem.y);
        maxX = Math.max(maxX, elem.x);
        maxY = Math.max(maxY, elem.y);
      } else {
        minX = Math.min(minX, elem.start.x, elem.end.x);
        minY = Math.min(minY, elem.start.y, elem.end.y);
        maxX = Math.max(maxX, elem.start.x, elem.end.x);
        maxY = Math.max(maxY, elem.start.y, elem.end.y);
      }
    });
    return {
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2
    };
  }

  function rotatePoint(point, center, angle) {
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    point.x = center.x + dx * Math.cos(angle) - dy * Math.sin(angle);
    point.y = center.y + dx * Math.sin(angle) + dy * Math.cos(angle);
  }

  function addDimension() {
    if (selectedElements.length === 1 && selectedElements[0].type === 'line') {
      const line = selectedElements[0];
      const dx = line.end.x - line.start.x;
      const dy = line.end.y - line.start.y;
      const angle = Math.atan2(dy, dx);
      const offset = mmToPixels(7);
      
      const dimension = {
        type: 'dimension',
        start: {
          x: line.start.x - Math.sin(angle) * offset,
          y: line.start.y + Math.cos(angle) * offset
        },
        end: {
          x: line.end.x - Math.sin(angle) * offset,
          y: line.end.y + Math.cos(angle) * offset
        },
        refStart: { ...line.start },
        refEnd: { ...line.end },
        offset: offset,
        customText: null
      };

      saveState();
      dimensions.push(dimension);
      drawCanvas();
    }
  }

  function addManualDimension() {
    if (manualDimensionPoints.length === 2) {
      const [start, end] = manualDimensionPoints;
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      let angle = Math.atan2(dy, dx);

      const offset = mmToPixels(7);
      
      const dimension = {
        type: 'dimension',
        start: {
          x: start.x - Math.sin(angle) * offset,
          y: start.y + Math.cos(angle) * offset
        },
        end: {
          x: end.x - Math.sin(angle) * offset,
          y: end.y + Math.cos(angle) * offset
        },
        refStart: { ...start },
        refEnd: { ...end },
        offset: offset,
        customText: null
      };

      saveState();
      dimensions.push(dimension);
      manualDimensionPoints = [];
      drawCanvas();
    }
  }

  function startEditingDimension(dimension) {
    isEditingDimension = true;
    editingDimension = dimension;
    tool = 'editDimension';
  }

  function handleDimensionEdit(e) {
    if (!isEditingDimension || !editingDimension) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (distance({x, y}, editingDimension.start) < mmToPixels(5)) {
      moveDimension(editingDimension, x - editingDimension.start.x, y - editingDimension.start.y);
    } else if (distance({x, y}, editingDimension.end) < mmToPixels(5)) {
      const dx = x - editingDimension.end.x;
      const dy = y - editingDimension.end.y;
      editingDimension.end.x = x;
      editingDimension.end.y = y;
      editingDimension.start.x += dx;
      editingDimension.start.y += dy;
    } else {
      const newOffset = distanceToLine(x, y, editingDimension.refStart.x, editingDimension.refStart.y, editingDimension.refEnd.x, editingDimension.refEnd.y);
      adjustDimensionOffset(editingDimension, newOffset);
    }

    drawCanvas();
  }

  function moveDimension(dimension, dx, dy) {
    dimension.start.x += dx;
    dimension.start.y += dy;
    dimension.end.x += dx;
    dimension.end.y += dy;
  }

  function adjustDimensionOffset(dimension, newOffset) {
    const angle = Math.atan2(dimension.refEnd.y - dimension.refStart.y, dimension.refEnd.x - dimension.refStart.x);
    dimension.start.x = dimension.refStart.x - Math.sin(angle) * newOffset;
    dimension.start.y = dimension.refStart.y + Math.cos(angle) * newOffset;
    dimension.end.x = dimension.refEnd.x - Math.sin(angle) * newOffset;
    dimension.end.y = dimension.refEnd.y + Math.cos(angle) * newOffset;
    dimension.offset = newOffset;
  }

  function drawCanvas() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw grid
    ctx.strokeStyle = '#eee';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= canvas.width; i += mmToPixels(GRID_SIZE)) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, canvas.height);
      ctx.stroke();
    }
    for (let i = 0; i <= canvas.height; i += mmToPixels(GRID_SIZE)) {
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(canvas.width, i);
      ctx.stroke();
    }

    // Draw page border
    ctx.strokeStyle = '#999';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, canvas.width, canvas.height);

    // Draw lines
    lines.forEach(line => {
      ctx.strokeStyle = selectedElements.includes(line) ? 'blue' : 'black';
      ctx.lineWidth = mmToPixels(line.thickness || DEFAULT_LINE_THICKNESS);
      ctx.beginPath();
      ctx.moveTo(line.start.x, line.start.y);
      ctx.lineTo(line.end.x, line.end.y);
      ctx.stroke();
    });

    // Draw dimensions
    dimensions.forEach(dim => {
      drawDimension(dim, selectedElements.includes(dim) ? 'blue' : cotaStyle.color, false);
    });

    // Draw texts
    texts.forEach(textObj => {
      ctx.font = textObj.font;
      ctx.fillStyle = selectedElements.includes(textObj) ? 'blue' : textObj.color;
      ctx.fillText(textObj.text, textObj.x, textObj.y);
    });

    // Draw current line with real-time dimension
    if (currentLine) {
      ctx.strokeStyle = 'blue';
      ctx.lineWidth = mmToPixels(DEFAULT_LINE_THICKNESS);
      ctx.beginPath();
      ctx.moveTo(currentLine.start.x, currentLine.start.y);
      ctx.lineTo(currentLine.end.x, currentLine.end.y);
      ctx.stroke();

      // Draw real-time dimension
      drawDimension(currentLine, 'blue', true);
    }

    // Draw hovered element
    if (hoveredElement) {
      ctx.strokeStyle = 'orange';
      ctx.lineWidth = mmToPixels(hoveredElement.thickness || DEFAULT_LINE_THICKNESS) + 2;
      ctx.beginPath();
      ctx.moveTo(hoveredElement.start.x, hoveredElement.start.y);
      ctx.lineTo(hoveredElement.end.x, hoveredElement.end.y);
      ctx.stroke();
    }

    // Draw manual dimension preview
    if (previewDimension) {
      drawDimension(previewDimension, 'gray', true);
    }

    // Draw points for manual dimensioning
    if (tool === 'manualDimension' && manualDimensionPoints.length > 0) {
      ctx.fillStyle = 'red';
      manualDimensionPoints.forEach(point => {
        ctx.beginPath();
        ctx.arc(point.x, point.y, mmToPixels(1), 0, 2 * Math.PI);
        ctx.fill();
      });
    }

    // Draw eraser preview
    if (tool === 'eraser') {
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      
      ctx.strokeStyle = 'red';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, eraserSize / 2, 0, 2 * Math.PI);
      ctx.stroke();
    }

    // Draw symmetry axes if enabled
    if (showSymmetryAxes) {
      lines.forEach(line => {
        drawSymmetryAxis(line);
      });
    }
  }

  function drawDimension(dim, color, isTemporary = false) {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = mmToPixels(0.25);
    ctx.font = cotaStyle.font;

    const dx = dim.end.x - dim.start.x;
    const dy = dim.end.y - dim.start.y;
    const length = calculateLength(dim.start, dim.end);
    const angle = Math.atan2(dy, dx);
    
    if (!isTemporary) {
      const extensionOffset = mmToPixels(2);
      const extensionLength = mmToPixels(5);

      drawExtensionLine(dim.start, angle, extensionOffset, extensionLength);
      drawExtensionLine(dim.end, angle, extensionOffset, extensionLength);

      ctx.beginPath();
      ctx.moveTo(dim.start.x, dim.start.y);
      ctx.lineTo(dim.end.x, dim.end.y);
      ctx.stroke();

      drawDimensionArrow(dim.start, angle);
      drawDimensionArrow(dim.end, angle + Math.PI);

      // Draw control points for dimension editing
      ctx.fillStyle = 'blue';
      ctx.beginPath();
      ctx.arc(dim.start.x, dim.start.y, mmToPixels(1), 0, 2 * Math.PI);
      ctx.arc(dim.end.x, dim.end.y, mmToPixels(1), 0, 2 * Math.PI);
      ctx.fill();
    }

    const midX = (dim.start.x + dim.end.x) / 2;
    const midY = (dim.start.y + dim.end.y) / 2;
    const text = dim.customText || `${length.toFixed(2)} ${measureUnit}`;
    drawDimensionText(midX, midY, angle, text, isTemporary);
  }

  function drawExtensionLine(point, angle, offset, length) {
    const perpAngle = angle + Math.PI / 2;
    const startX = point.x + Math.cos(perpAngle) * offset;
    const startY = point.y + Math.sin(perpAngle) * offset;
    const endX = startX + Math.cos(perpAngle) * length;
    const endY = startY + Math.sin(perpAngle) * length;

    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, endY);
    ctx.stroke();
  }

  function drawDimensionArrow(point, angle) {
    const arrowSize = mmToPixels(1);
    ctx.beginPath();
    if (cotaStyle.arrowType === 'arrow') {
      ctx.moveTo(point.x, point.y);
      ctx.lineTo(point.x - Math.cos(angle) * arrowSize - Math.sin(angle) * arrowSize/2,
                 point.y - Math.sin(angle) * arrowSize + Math.cos(angle) * arrowSize/2);
      ctx.lineTo(point.x - Math.cos(angle) * arrowSize + Math.sin(angle) * arrowSize/2,
                 point.y - Math.sin(angle) * arrowSize - Math.cos(angle) * arrowSize/2);
      ctx.closePath();
      ctx.fill();
    } else if (cotaStyle.arrowType === 'dot') {
      ctx.arc(point.x, point.y, arrowSize / 2, 0, 2 * Math.PI);
      ctx.fill();
    } else if (cotaStyle.arrowType === 'slash') {
      ctx.moveTo(point.x - Math.cos(angle + Math.PI/4) * arrowSize,
                 point.y - Math.sin(angle + Math.PI/4) * arrowSize);
      ctx.lineTo(point.x + Math.cos(angle + Math.PI/4) * arrowSize,
                 point.y + Math.sin(angle + Math.PI/4) * arrowSize);
      ctx.stroke();
    }
  }

  function drawDimensionText(x, y, angle, text, isTemporary) {
    const textOffset = isTemporary ? mmToPixels(-3) : mmToPixels(-1);
    
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    
    const textMetrics = ctx.measureText(text);
    const padding = mmToPixels(0.5);
    ctx.fillStyle = 'white';
    ctx.fillRect(-textMetrics.width / 2 - padding, textOffset - mmToPixels(2) - padding, 
                 textMetrics.width + 2*padding, mmToPixels(4) + 2*padding);
    
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fillText(text, -textMetrics.width / 2, textOffset);
    ctx.restore();
  }

  function drawSymmetryAxis(line) {
    const midX = (line.start.x + line.end.x) / 2;
    const midY = (line.start.y + line.end.y) / 2;
    const angle = Math.atan2(line.end.y - line.start.y, line.end.x - line.start.x);
    const perpendicularAngle = angle + Math.PI / 2;
    
    const axisLength = mmToPixels(20);
    
    ctx.strokeStyle = 'rgba(255, 0, 0, 0.5)';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);
    
    ctx.beginPath();
    ctx.moveTo(midX - Math.cos(perpendicularAngle) * axisLength / 2, 
               midY - Math.sin(perpendicularAngle) * axisLength / 2);
    ctx.lineTo(midX + Math.cos(perpendicularAngle) * axisLength / 2, 
               midY + Math.sin(perpendicularAngle) * axisLength / 2);
    ctx.stroke();
    
    drawSymmetryAxisArrow(midX - Math.cos(perpendicularAngle) * axisLength / 2, 
                          midY - Math.sin(perpendicularAngle) * axisLength / 2, 
                          perpendicularAngle - Math.PI, mmToPixels(2));
    drawSymmetryAxisArrow(midX + Math.cos(perpendicularAngle) * axisLength / 2, 
                          midY + Math.sin(perpendicularAngle) * axisLength / 2, 
                          perpendicularAngle, mmToPixels(2));
    
    ctx.setLineDash([]);
  }

  function drawSymmetryAxisArrow(x, y, angle, size) {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - Math.cos(angle - Math.PI/6) * size, 
               y - Math.sin(angle - Math.PI/6) * size);
    ctx.moveTo(x, y);
    ctx.lineTo(x - Math.cos(angle + Math.PI/6) * size, 
               y - Math.sin(angle + Math.PI/6) * size);
    ctx.stroke();
  }

  function calculateLength(start, end) {
    const dx = pixelsToMm(end.x - start.x);
    const dy = pixelsToMm(end.y - start.y);
    const lengthInMm = Math.sqrt(dx*dx + dy*dy);
    return measureUnit === 'mm' ? lengthInMm : lengthInMm / 10;
  }

  function saveState() {
    undoStack.push(JSON.stringify({ lines, dimensions, texts }));
    redoStack = [];
  }

  function undo() {
    if (undoStack.length > 0) {
      redoStack.push(JSON.stringify({ lines, dimensions, texts }));
      const prevState = JSON.parse(undoStack.pop());
      lines = prevState.lines;
      dimensions = prevState.dimensions;
      texts = prevState.texts;
      drawCanvas();
    }
  }

  function redo() {
    if (redoStack.length > 0) {
      undoStack.push(JSON.stringify({ lines, dimensions, texts }));
      const nextState = JSON.parse(redoStack.pop());
      lines = nextState.lines;
      dimensions = nextState.dimensions;
      texts = nextState.texts;
      drawCanvas();
    }
  }

  function exportToPNG() {
    const link = document.createElement('a');
    link.download = 'desen_tehnic_A4.png';
    link.href = canvas.toDataURL();
    link.click();
  }

  function toggleUnit() {
    measureUnit = measureUnit === 'mm' ? 'cm' : 'mm';
    document.getElementById('unitBtn').textContent = `Unitate: ${measureUnit}`;
    drawCanvas();
  }

  function toggleOrientation() {
    isPortrait = !isPortrait;
    updateCanvasSize();
    drawCanvas();
  }

  function toggleSymmetryAxes() {
    showSymmetryAxes = !showSymmetryAxes;
    drawCanvas();
  }

  function startErasing(e) {
    isErasing = true;
    eraseAt(e);
  }

  function stopErasing() {
    isErasing = false;
    saveState();
  }

  function eraseAt(e) {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    lines = lines.flatMap(line => {
      const newLines = splitLine(line, x, y);
      return newLines.filter(newLine => !lineIntersectsEraser(newLine, x, y));
    });

    dimensions = dimensions.filter(dim => !lineIntersectsEraser(dim, x, y));
    texts = texts.filter(text => !textIntersectsEraser(text, x, y));

    drawCanvas();
  }

  function lineIntersectsEraser(line, eraserX, eraserY) {
    const dx = line.end.x - line.start.x;
    const dy = line.end.y - line.start.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    
    if (len === 0) return false;

    const u = ((eraserX - line.start.x) * dx + (eraserY - line.start.y) * dy) / (len * len);

    if (u < 0 || u > 1) return false;

    const x = line.start.x + u * dx;
    const y = line.start.y + u * dy;

    return Math.sqrt((x - eraserX) * (x - eraserX) + (y - eraserY) * (y - eraserY)) <= eraserSize / 2;
  }

  function textIntersectsEraser(text, eraserX, eraserY) {
    const textWidth = ctx.measureText(text.text).width;
    const textHeight = parseInt(text.font);

    return (eraserX >= text.x && eraserX <= text.x + textWidth &&
            eraserY >= text.y - textHeight && eraserY <= text.y);
  }

  function splitLine(line, x, y) {
    const intersections = getIntersections(line, x, y);
    if (intersections.length === 0) return [line];

    const newLines = [];
    let lastPoint = line.start;

    for (const point of intersections) {
      if (distance(lastPoint, point) > 1) {
        newLines.push({...line, start: lastPoint, end: point});
      }
      lastPoint = point;
    }

    if (distance(lastPoint, line.end) > 1) {
      newLines.push({...line, start: lastPoint, end: line.end});
    }

    return newLines;
  }

  function getIntersections(line, x, y) {
    const r = eraserSize / 2;
    const dx = line.end.x - line.start.x;
    const dy = line.end.y - line.start.y;
    const a = dx * dx + dy * dy;
    const b = 2 * (dx * (line.start.x - x) + dy * (line.start.y - y));
    const c = (line.start.x - x) * (line.start.x - x) + (line.start.y - y) * (line.start.y - y) - r * r;

    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) return [];

    const t1 = (-b + Math.sqrt(discriminant)) / (2 * a);
    const t2 = (-b - Math.sqrt(discriminant)) / (2 * a);

    const intersections = [];
    if (t1 >= 0 && t1 <= 1) intersections.push({x: line.start.x + t1 * dx, y: line.start.y + t1 * dy});
    if (t2 >= 0 && t2 <= 1) intersections.push({x: line.start.x + t2 * dx, y: line.start.y + t2 * dy});

    return intersections;
  }

  function distance(point1, point2) {
    return Math.sqrt(Math.pow(point2.x - point1.x, 2) + Math.pow(point2.y - point1.y, 2));
  }

  function startDrawingText(e) {
    if (!isAddingText) {
      isAddingText = true;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      textStartPoint = { x, y };
      showTextInput(x, y);
    }
  }

  function showTextInput(x, y) {
    const textInput = document.createElement('input');
    textInput.type = 'text';
    textInput.style.position = 'absolute';
    textInput.style.left = `${x}px`;
    textInput.style.top = `${y + 20}px`;
    textInput.style.zIndex = '1000';
    
    textInput.addEventListener('input', updateText);
    textInput.addEventListener('blur', finishText);
    textInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        finishText();
      }
    });
    
    document.body.appendChild(textInput);
    textInput.focus();
  }

  function updateText(e) {
    currentText = e.target.value;
    drawCanvas();
    ctx.font = '14px Arial';
    ctx.fillStyle = 'black';
    ctx.fillText(currentText, textStartPoint.x, textStartPoint.y);
  }

  function finishText() {
    if (currentText) {
      texts.push({
        id: Date.now(),
        text: currentText,
        x: textStartPoint.x,
        y: textStartPoint.y,
        font: '14px Arial',
        color: 'black'
      });
      saveState();
    }
    const textInput = document.querySelector('input[type="text"]');
    if (textInput) {
      document.body.removeChild(textInput);
    }
    currentText = '';
    textStartPoint = null;
    isAddingText = false;
    drawCanvas();
  }

  function editText(textObj) {
    isEditingText = true;
    editingTextId = textObj.id;
    showTextInput(textObj.x, textObj.y);
    document.querySelector('input[type="text"]').value = textObj.text;
  }

  function updateEditedText() {
    const textObj = texts.find(t => t.id === editingTextId);
    if (textObj) {
      textObj.text = currentText;
      saveState();
    }
    isEditingText = false;
    editingTextId = null;
  }

  function editDimensionText(dimension) {
    const midX = (dimension.start.x + dimension.end.x) / 2;
    const midY = (dimension.start.y + dimension.end.y) / 2;
    showTextInput(midX, midY);
    document.querySelector('input[type="text"]').value = dimension.customText || '';
    isEditingText = true;
    editingTextId = dimension.id;
  }

  function updateInstructions() {
    const instructions = document.getElementById('instructions');
    instructions.innerHTML = `
      <p>Instrucțiuni:</p>
      <ul>
        <li>Apăsați butonul "Linie" pentru a desena linii (veți vedea cota în timp real)</li>
        <li>Apăsați butonul "Selectează" și trageți pentru a selecta multiple elemente într-o zonă</li>
        <li>Apăsați butonul "Mută" pentru a muta elementele selectate (se va alinia automat la puncte existente)</li>
        <li>Folosiți butonul "Rotire" pentru a roti elementele selectate cu 5 grade</li>
        <li>Selectați o linie și apăsați "Adaugă Cotă" pentru a adăuga o cotă permanentă</li>
        <li>Personalizați stilul cotei folosind opțiunile "Culoare Cotă", "Font Cotă" și "Tip Săgeată"</li>
        <li>Apăsați "Cotare Manuală" și faceți clic pe două puncte pentru a adăuga o cotă manuală</li>
        <li>Folosiți "Radieră" pentru a șterge sau tăia linii</li>
        <li>Apăsați "Text" pentru a adăuga text în desen</li>
        <li>Schimbați unitatea de măsură între mm și cm folosind butonul "Unitate"</li>
        <li>Folosiți butoanele "Undo" și "Redo" pentru a anula sau reface acțiunile</li>
        <li>Apăsați "Export PNG" pentru a salva desenul ca imagine PNG</li>
        <li>Ajustați dimensiunea grid-ului folosind controlul "Grid Size"</li>
        <li>Selectați o linie și modificați grosimea acesteia folosind controlul "Grosime linie"</li>
        <li>Apăsați "Schimbă Orientare" pentru a comuta între Portrait și Landscape</li>
        <li>Apăsați "Afișează/Ascunde Axe de Simetrie" pentru a vizualiza axele de simetrie</li>
      </ul>
    `;
  }

  function init() {
    document.getElementById('lineBtn').addEventListener('click', () => { tool = 'line'; });
    document.getElementById('selectBtn').addEventListener('click', () => { tool = 'select'; });
    document.getElementById('moveBtn').addEventListener('click', () => { tool = 'move'; });
    document.getElementById('dimensionBtn').addEventListener('click', addDimension);
    document.getElementById('manualDimensionBtn').addEventListener('click', () => { 
      tool = 'manualDimension';
      manualDimensionPoints = [];
    });
    document.getElementById('eraserBtn').addEventListener('click', () => { tool = 'eraser'; });
    document.getElementById('textBtn').addEventListener('click', () => { 
      tool = 'text'; 
      canvas.style.cursor = 'text';
    });
    document.getElementById('unitBtn').addEventListener('click', toggleUnit);
    document.getElementById('undoBtn').addEventListener('click', undo);
    document.getElementById('redoBtn').addEventListener('click', redo);
    document.getElementById('exportBtn').addEventListener('click', exportToPNG);
    document.getElementById('orientationBtn').addEventListener('click', toggleOrientation);
    document.getElementById('gridSize').addEventListener('change', updateGridSize);
    document.getElementById('lineThickness').addEventListener('input', updateLineThickness);
    document.getElementById('lineLength').addEventListener('change', setLineLength);
    document.getElementById('rotateBtn').addEventListener('click', rotateElements);
    document.getElementById('cotaColor').addEventListener('change', changeCotaColor);
    document.getElementById('cotaFont').addEventListener('change', changeCotaFont);
    document.getElementById('cotaArrow').addEventListener('change', changeCotaArrow);
    document.getElementById('symmetryAxesBtn').addEventListener('click', toggleSymmetryAxes);
    document.getElementById('eraserSize').addEventListener('input', (e) => {
      eraserSize = parseInt(e.target.value);
    });

    canvas.addEventListener('mousedown', startDrawing);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', endDrawing);
    canvas.addEventListener('mouseleave', endDrawing);
    canvas.addEventListener('click', (e) => {
      if (tool === 'text') {
        startDrawingText(e);
      }
    });

    addHoverFunctionality();

    updateCanvasSize();
    drawCanvas();
    updateInstructions();
  }

  function addHoverFunctionality() {
    canvas.addEventListener('mousemove', handleHover);
    canvas.addEventListener('mouseout', clearHover);
  }

  function handleHover(e) {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    hoveredElement = findElementUnderCursor(x, y);
    
    if (hoveredElement) {
      canvas.style.cursor = 'pointer';
      drawCanvas();
      showTooltip(hoveredElement, e.clientX, e.clientY);
    } else {
      canvas.style.cursor = 'default';
      clearTooltip();
      drawCanvas();
    }
  }

  function clearHover() {
    hoveredElement = null;
    canvas.style.cursor = 'default';
    clearTooltip();
    drawCanvas();
  }

  function findElementUnderCursor(x, y) {
    const allElements = [...lines, ...dimensions, ...texts];
    return allElements.find(elem => 
      distanceToLine(x, y, elem.start.x, elem.start.y, elem.end.x, elem.end.y) < mmToPixels(2)
    );
  }

  function showTooltip(element, x, y) {
    let tooltipContent = '';
    if (element.type === 'line') {
      const length = calculateLength(element.start, element.end);
      tooltipContent = `Lungime: ${length.toFixed(2)} ${measureUnit}<br>Grosime: ${element.thickness} mm`;
    } else if (element.type === 'dimension') {
      tooltipContent = `Cotă: ${calculateLength(element.start, element.end).toFixed(2)} ${measureUnit}`;
    } else if (element.type === 'text') {
      tooltipContent = `Text: ${element.text}`;
    }

    const tooltip = document.getElementById('tooltip');
    tooltip.innerHTML = tooltipContent;
    tooltip.style.left = `${x + 10}px`;
    tooltip.style.top = `${y + 10}px`;
    tooltip.style.display = 'block';
  }

  function clearTooltip() {
    const tooltip = document.getElementById('tooltip');
    tooltip.style.display = 'none';
  }

  function changeCotaColor() {
    cotaStyle.color = document.getElementById('cotaColor').value;
    drawCanvas();
  }

  function changeCotaFont() {
    cotaStyle.font = document.getElementById('cotaFont').value;
    drawCanvas();
  }

  function changeCotaArrow() {
    cotaStyle.arrowType = document.getElementById('cotaArrow').value;
    drawCanvas();
  }

  function updateGridSize() {
    GRID_SIZE = parseInt(document.getElementById('gridSize').value);
    drawCanvas();
  }

  function updateLineThickness() {
    const thickness = parseFloat(document.getElementById('lineThickness').value);
    if (selectedElements.length > 0) {
      selectedElements.forEach(element => {
        if (element.type === 'line') {
          element.thickness = thickness;
        }
      });
      saveState();
      drawCanvas();
    } else {
      DEFAULT_LINE_THICKNESS = thickness;
    }
  }

  // Inițializarea aplicației
  init();
})();

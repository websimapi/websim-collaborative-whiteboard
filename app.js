document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('whiteboard');
    const ctx = canvas.getContext('2d');
    const colorPicker = document.getElementById('color-picker');
    const brushSize = document.getElementById('brush-size');
    const clearBtn = document.getElementById('clear-btn');
    const loadingOverlay = document.getElementById('loading-overlay');
    const cursorsContainer = document.getElementById('cursors-container');

    let drawing = false;
    let lastPos = null;
    let currentStroke = [];

    const room = new WebsimSocket();

    const resizeCanvas = () => {
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
    };

    const redrawAllStrokes = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const strokes = room.collection('stroke_v1').getList();
        strokes.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        strokes.forEach(stroke => {
            if (stroke.points && stroke.points.length > 1) {
                drawStrokeOnCanvas(stroke.points, stroke.color, stroke.size);
            }
        });
    };

    window.addEventListener('resize', () => {
        resizeCanvas();
        redrawAllStrokes();
    });

    resizeCanvas();

    const getEventPosition = (e) => {
        if (e.touches && e.touches.length > 0) {
            e.preventDefault();
            return { x: e.touches[0].clientX, y: e.touches[0].clientY };
        }
        return { x: e.clientX, y: e.clientY };
    };

    const startDrawing = (e) => {
        const pos = getEventPosition(e);
        const canvasRect = canvas.getBoundingClientRect();
        drawing = true;
        lastPos = { x: pos.x - canvasRect.left, y: pos.y - canvasRect.top };
        currentStroke = [lastPos];
    };

    const draw = (e) => {
        if (!drawing) return;
        const pos = getEventPosition(e);
        const canvasRect = canvas.getBoundingClientRect();
        const currentPos = { x: pos.x - canvasRect.left, y: pos.y - canvasRect.top };

        if (lastPos) {
            const strokeSegment = [lastPos, currentPos];
            const data = {
                type: 'draw',
                points: strokeSegment,
                color: colorPicker.value,
                size: brushSize.value
            };
            room.send(data);
            drawStrokeOnCanvas(strokeSegment, data.color, data.size);

            lastPos = currentPos;
            currentStroke.push(currentPos);
        }
    };

    const stopDrawing = () => {
        if (!drawing) return;
        drawing = false;
        lastPos = null;
        if (currentStroke.length > 1) {
            room.collection('stroke_v1').create({
                points: currentStroke,
                color: colorPicker.value,
                size: brushSize.value
            });
        }
        currentStroke = [];
    };

    const drawStrokeOnCanvas = (points, color, size) => {
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = size;
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
            ctx.lineTo(points[i].x, points[i].y);
        }
        ctx.stroke();
    };

    const updateCursors = () => {
        const peers = room.peers;
        const presence = room.presence;

        Object.keys(peers).forEach(clientId => {
            if (clientId === room.clientId) return;

            const peerPresence = presence[clientId];
            let cursorEl = document.getElementById(`cursor-${clientId}`);

            if (peerPresence && peerPresence.x != null) {
                if (!cursorEl) {
                    cursorEl = document.createElement('div');
                    cursorEl.id = `cursor-${clientId}`;
                    cursorEl.className = 'cursor';
                    const label = document.createElement('div');
                    label.className = 'cursor-label';
                    label.textContent = peers[clientId]?.username || '...';
                    cursorEl.appendChild(label);
                    cursorsContainer.appendChild(cursorEl);
                }
                const canvasRect = canvas.getBoundingClientRect();
                cursorEl.style.left = `${peerPresence.x + canvasRect.left}px`;
                cursorEl.style.top = `${peerPresence.y}px`; // Already relative to window top
            } else if (cursorEl) {
                cursorEl.remove();
            }
        });

        // Clean up cursors for disconnected clients
        Array.from(cursorsContainer.children).forEach(cursor => {
            const clientId = cursor.id.replace('cursor-', '');
            if (!peers[clientId]) {
                cursor.remove();
            }
        });
    };

    const sendCursorPosition = (e) => {
        const pos = getEventPosition(e);
        room.updatePresence({ x: pos.x, y: pos.y });
    };

    canvas.addEventListener('mousedown', startDrawing);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDrawing);
    canvas.addEventListener('mouseout', stopDrawing);

    canvas.addEventListener('touchstart', startDrawing);
    canvas.addEventListener('touchmove', draw);
    canvas.addEventListener('touchend', stopDrawing);
    canvas.addEventListener('touchcancel', stopDrawing);

    document.addEventListener('mousemove', sendCursorPosition);
    document.addEventListener('touchmove', sendCursorPosition);

    clearBtn.addEventListener('click', async () => {
        const strokes = room.collection('stroke_v1').getList();
        // This is a simplified clear - only the user who clicks can delete their own strokes.
        // A full "admin clear" would require different logic.
        for (const stroke of strokes) {
            try {
                await room.collection('stroke_v1').delete(stroke.id);
            } catch (e) {
                // Ignore errors trying to delete others' strokes
            }
        }
    });

    room.onmessage = (event) => {
        const data = event.data;
        if (data.type === 'draw' && data.clientId !== room.clientId) {
            drawStrokeOnCanvas(data.points, data.color, data.size);
        }
    };

    const setupSubscriptions = () => {
        room.collection('stroke_v1').subscribe(() => {
            redrawAllStrokes();
        });

        room.subscribePresence(() => {
            updateCursors();
        });
    };

    const main = async () => {
        try {
            await room.initialize();
            loadingOverlay.classList.add('hidden');
            setupSubscriptions();
            redrawAllStrokes();
        } catch (error) {
            console.error('Failed to initialize room:', error);
            loadingOverlay.innerHTML = "<p>Could not connect. Please refresh.</p>";
        }
    };

    main();
});
// Variables
const canvasDraw = document.getElementById("canvasDraw")
const canvasGrid = document.getElementById("canvasGrid")

let lineColorSelect = document.getElementById("selColor")
let lineWidthSelect = document.getElementById("selWidth")
let lineColor = lineColorSelect.options[lineColorSelect.selectedIndex].value
let lineWidth = lineWidthSelect.options[lineWidthSelect.selectedIndex].value

let clearCursor = false
let selectCanvas = false

// Onload window
var drawPath
var drawTool
var eraseTool
var path, tmpGroup, mask
window.onload = function () {
    paper.install(window)
    paper.setup(canvasDraw)

    // new layer for drawing and erasing on
    var topLayer = new paper.Layer()

    // tool for drawing simple strokes on topLayer
    drawTool = new paper.Tool()
    drawTool.minDistance = 5

    drawTool.onMouseDown = function () {
        if (writeText) {
            getPosition(event)
            var item = new PointText({
                point: [coord.x, coord.y],
                content: "The contents of the point text",
                fillColor: "black",
                fontSize: 25,
                // selected: true,
            })
            var resizeVector
            var moving
            item.onClick = function () {
                if (item.selected) {
                    item.selected = false
                } else {
                    item.selected = true
                }
            }
            item.onDoubleClick = function () {
                var bounds = item.bounds
                var textarea = $(
                    "<textarea id='textarea' class='dynamic-textarea' " +
                        "style='position:absolute; left:" +
                        bounds.x +
                        "px; top:" +
                        bounds.y +
                        "px; width: " +
                        bounds.width +
                        "px; height: " +
                        bounds.height +
                        "px; resize; z-index: 5' placeholder='Enter text'></textarea>"
                )
                $("#canvas").append(textarea)
                $("#textarea").keypress(function (e) {
                    if (e.which == 13) {
                        item.content = document.getElementById("textarea").value
                        e.preventDefault()
                        document
                            .getElementById("canvas")
                            .remove(document.getElementById("textarea"))
                    }
                })
            }
            item.onMouseDrag = function (event) {
                // ...if a corner was previously hit...
                if (resizeVector) {
                    // ...calculate new vector from item center to point
                    var newVector = event.point - item.bounds.center
                    // scale item so current mouse position is corner position
                    item.scale(newVector / resizeVector)
                    // store vector for next event
                    resizeVector = newVector
                    // ...if item fill was previously hit...
                } else {
                    // ...move item
                    item.position = event.point
                }
            }
            item.onMouseDown = function (event) {
                // ...do a hit test on item bounds with a small tolerance for better UX
                var cornerHit = item.hitTest(event.point, {
                    bounds: true,
                    tolerance: 10,
                })
                // if a hit is detected on one of the corners...
                if (
                    cornerHit &&
                    [
                        "top-left",
                        "top-right",
                        "bottom-left",
                        "bottom-right",
                    ].indexOf(cornerHit.name) >= 0
                ) {
                    console.log("tesssst")

                    // ...store current vector from item center to point
                    resizeVector = event.point - item.bounds.center
                    // ...else if hit is detected inside item...
                } else if (item.hitTest(event.point, { fill: true })) {
                    // ...store moving state
                    moving = true
                }
            }
            item.onMouseUp = function (event) {
                // ... reset state
                resizeVector = null
                moving = null
            }
            writeText = false
        } else if (!selectCanvas) {
            drawPath = new paper.Path({
                strokeColor: lineColor,
                strokeWidth: lineWidth * view.pixelRatio,
                strokeCap: "round",
                strokeJoin: "round",
            })
        }
    }

    drawTool.onMouseDrag = function (event) {
        if (!writeText && !selectCanvas) drawPath.add(event.point)
    }

    // tool that 'erases' within the active layer only. first it simulates erasing
    // using a stroked path and blend modes while you draw. onMouseUp it converts
    // the toolpath to a shape and uses that to path.subtract() from each path

    eraseTool = new paper.Tool()
    eraseTool.minDistance = 10

    eraseTool.onMouseDown = function (event) {
        // create the path object that will record the toolpath
        path = new paper.Path({
            strokeWidth: lineWidth * view.pixelRatio,
            strokeCap: "round",
            strokeJoin: "round",
            strokeColor: "white",
        })

        // move everything on the active layer into a group with 'source-out' blend
        tmpGroup = new paper.Group({
            children: topLayer.removeChildren(),
            blendMode: "source-out",
            insert: false,
        })

        // combine the path and group in another group with a blend of 'source-over'
        mask = new paper.Group({
            children: [path, tmpGroup],
            blendMode: "source-over",
        })
    }

    eraseTool.onMouseDrag = function (event) {
        // onMouseDrag simply adds points to the path
        path.add(event.point)
    }

    eraseTool.onMouseUp = function (event) {
        // simplify the path first, to make the following perform better
        path.simplify()

        var eraseRadius = (lineWidth * view.pixelRatio) / 2

        // find the offset path on each side of the line
        // this uses routines in the offset.js file
        var outerPath = OffsetUtils.offsetPath(path, eraseRadius)
        var innerPath = OffsetUtils.offsetPath(path, -eraseRadius)
        path.remove() // done w/ this now

        outerPath.insert = false
        innerPath.insert = false
        innerPath.reverse() // reverse one path so we can combine them end-to-end

        // create a new path and connect the two offset paths into one shape
        var deleteShape = new paper.Path({
            closed: true,
            insert: false,
        })
        deleteShape.addSegments(outerPath.segments)
        deleteShape.addSegments(innerPath.segments)

        // create round endcaps for the shape
        // as they aren't included in the offset paths
        var endCaps = new paper.CompoundPath({
            children: [
                new paper.Path.Circle({
                    center: path.firstSegment.point,
                    radius: eraseRadius,
                }),
                new paper.Path.Circle({
                    center: path.lastSegment.point,
                    radius: eraseRadius,
                }),
            ],
            insert: false,
        })

        // unite the shape with the endcaps
        // this also removes all overlaps from the stroke
        deleteShape = deleteShape.unite(endCaps)
        deleteShape.simplify()

        // grab all the items from the tmpGroup in the mask group
        var items = tmpGroup.getItems({ overlapping: deleteShape.bounds })

        items.forEach(function (item) {
            var result = item.subtract(deleteShape, {
                trace: false,
                insert: false,
            }) // probably need to detect closed vs open path and tweak these settings

            if (result.children) {
                // if result is compoundShape, yoink the individual paths out
                item.parent.insertChildren(item.index, result.removeChildren())
                item.remove()
            } else {
                if (result.length === 0) {
                    // a fully erased path will still return a 0-length path object
                    item.remove()
                } else {
                    item.replaceWith(result)
                }
            }
        })

        topLayer.addChildren(tmpGroup.removeChildren())
        mask.remove()
    }
    canvasDraw.style.cursor = "url('./icons/lapiz.png') -5 100, auto"

    resize()
    window.addEventListener("resize", resize)
}

// Context for the canvas for 2 dimensional operations
const ctx = canvasDraw.getContext("2d")
ctx.lineCap = "round"
const ctxGrid = canvasGrid.getContext("2d")

// Store the initial position of the cursor
let coord = { x: 0, y: 0 }

// Flag to trigger drawing
let paint = false

// Flaf to trigger clear

let writeText = false

// Load the width and color of the line
function selectWidth() {
    lineWidth = lineWidthSelect.options[lineWidthSelect.selectedIndex].value

    if (clearCursor) {
        path.project.currentStyle.strokeWidth = lineWidth
    } else {
        drawPath.project.currentStyle.strokeWidth = lineWidth
    }
}
function selectColor() {
    lineColor = lineColorSelect.options[lineColorSelect.selectedIndex].value

    path.project.currentStyle.strokeColor = lineColor
}

// Resizes the canvas to the available size of the window
function resize() {
    paper.view.setViewSize(window.innerWidth, window.innerHeight)
    ctxGrid.canvas.width = window.innerWidth
    ctxGrid.canvas.height = window.innerHeight
    showCanvasGrid()
}

// Updates the coordinates of the cursor when an event is triggered
function getPosition(event) {
    coord.x = event.clientX - canvasDraw.offsetLeft
    coord.y = event.clientY - canvasDraw.offsetTop
}

// Clear all canvas
function clearCanvas() {
    paper.project.activeLayer.removeChildren()
    paper.view.draw()
}

// Clear canvas with cursor coords
function clearCanvasCursor() {
    var clearButton = document.getElementById("btnClear")
    if (clearCursor) {
        drawTool.activate()
        clearButton.classList.remove("active")
        canvasDraw.style.cursor = "url('./icons/lapiz.png') -5 100, auto"
    } else {
        eraseTool.activate()
        clearButton.classList.add("active")
        canvasDraw.style.cursor = "url('./icons/cuadrado.png') 8 10, auto"
    }
    clearCursor = !clearCursor
}

// Show / hide grid on canvas
function showCanvasGrid() {
    var showGrid = document.getElementById("grid").checked
    if (showGrid == false) {
        ctxGrid.clearRect(0, 0, canvasGrid.width, canvasGrid.height)
    } else {
        for (let x = 0.5; x < canvasGrid.width; x += 12) {
            ctxGrid.moveTo(x, 0)
            ctxGrid.lineTo(x, canvasGrid.height)
        }
        for (let y = 0.5; y < canvasGrid.height; y += 12) {
            ctxGrid.moveTo(0, y)
            ctxGrid.lineTo(canvasGrid.width, y)
        }
        ctxGrid.moveTo(0, 0)
        ctxGrid.strokeStyle = "#ddd"
        ctxGrid.stroke()
    }
}

// Save drawing
function saveCanvas() {
    var MIME_TYPE = "image/png"
    var imgURL = canvasDraw.toDataURL(MIME_TYPE)
    var name = document.getElementById("name").value
    if (!name) {
        alert("Debes poner un nombre")
        return
    }
    var dlLink = document.createElement("a")
    dlLink.download = name
    dlLink.href = imgURL
    dlLink.dataset.downloadurl = [MIME_TYPE, dlLink.download, dlLink.href].join(
        ":"
    )
    dlLink.click()
}

var imageLoader = document.getElementById("uploader")
// imageLoader.addEventListener("change", handleImage, false)

function handleImage(e) {
    var reader = new FileReader()
    reader.onload = function (event) {
        var img = new Image()
        img.onload = function () {
            ctx.drawImage(img, 10, 10)
        }
        img.src = event.target.result
    }
    reader.readAsDataURL(e.target.files[0])
}

function writeTextCanvas() {
    writeText = !writeText
    canvasDraw.style.cursor = "text"
}

function selectOnCanvas() {
    writeText = false
    canvasDraw.style.cursor = "default"
    selectCanvas = true
}

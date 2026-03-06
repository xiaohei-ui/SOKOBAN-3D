import './style.css'
import * as THREE from 'three'

type MappingMode = 'world' | 'camera'
type GameMode = 'menu' | 'playing' | 'won'
type MoveToken = 'up' | 'down' | 'left' | 'right'

interface GridPos {
  x: number
  z: number
}

interface LevelData {
  width: number
  height: number
  walls: GridPos[]
  goals: GridPos[]
  boxes: GridPos[]
  playerStart: GridPos
}

interface Snapshot {
  player: GridPos
  boxes: GridPos[]
  moveCount: number
}

interface GameState {
  mode: GameMode
  mappingMode: MappingMode
  player: GridPos
  boxes: GridPos[]
  history: Snapshot[]
  moveCount: number
}

interface MoveAnimation {
  from: THREE.Vector3
  to: THREE.Vector3
  elapsed: number
  duration: number
}

interface BoxAnimation extends MoveAnimation {
  index: number
}

interface CameraOrbitState {
  currentYaw: number
  targetYaw: number
  currentPitch: number
  targetPitch: number
  currentRadius: number
  targetRadius: number
  dragging: boolean
  lastX: number
  lastY: number
}

declare global {
  interface Window {
    render_game_to_text: () => string
    advanceTime: (ms: number) => void
  }
}

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) {
  throw new Error('Missing #app container')
}

app.innerHTML = `
  <div class="game-shell" id="game-shell">
    <div class="canvas-host" id="canvas-host">
      <div class="hud" id="hud">
        <div class="hud-title">立体推箱子</div>
        <div class="hud-row">
          <span class="hud-chip" id="move-chip">步数 0</span>
          <span class="hud-chip" id="mapping-chip">方向 世界</span>
          <span class="hud-chip" id="camera-chip">视角 45°</span>
        </div>
        <div class="hud-row">
          <span class="hud-chip hud-chip-soft" id="tilt-chip">仰角 0°</span>
          <span class="hud-chip hud-chip-soft" id="zoom-chip">缩放 1.00x</span>
        </div>
      </div>
      <div class="overlay menu-overlay" id="menu-overlay">
        <div class="panel">
          <div class="eyebrow">沉浸视角 / 平滑操作</div>
          <h1>立体推箱子</h1>
          <p>把所有箱子推到发光目标点。现在改为鼠标丝滑控镜头，移动也做了平滑过渡。</p>
          <ul>
            <li>移动: WASD / 方向键</li>
            <li>鼠标左键拖拽: 旋转镜头</li>
            <li>鼠标滚轮: 拉近/拉远</li>
            <li>方向模式切换: M (世界/镜头)</li>
            <li>撤销: Z | 重开: R | 全屏: F</li>
          </ul>
          <button id="start-btn" type="button">开始游戏</button>
        </div>
      </div>
      <div class="overlay win-overlay hidden" id="win-overlay">
        <div class="panel panel-win">
          <div class="eyebrow">通关</div>
          <h2>关卡完成</h2>
          <p id="win-summary"></p>
          <button id="restart-btn" type="button">再来一局</button>
        </div>
      </div>
    </div>
  </div>
`

const gameShell = document.querySelector<HTMLDivElement>('#game-shell')!
const canvasHost = document.querySelector<HTMLDivElement>('#canvas-host')!
const hud = document.querySelector<HTMLDivElement>('#hud')!
const moveChip = document.querySelector<HTMLSpanElement>('#move-chip')!
const mappingChip = document.querySelector<HTMLSpanElement>('#mapping-chip')!
const cameraChip = document.querySelector<HTMLSpanElement>('#camera-chip')!
const tiltChip = document.querySelector<HTMLSpanElement>('#tilt-chip')!
const zoomChip = document.querySelector<HTMLSpanElement>('#zoom-chip')!
const menuOverlay = document.querySelector<HTMLDivElement>('#menu-overlay')!
const winOverlay = document.querySelector<HTMLDivElement>('#win-overlay')!
const winSummary = document.querySelector<HTMLParagraphElement>('#win-summary')!
const startButton = document.querySelector<HTMLButtonElement>('#start-btn')!
const restartButton = document.querySelector<HTMLButtonElement>('#restart-btn')!

const levelData = buildLevelData([
  '#######',
  '#     #',
  '# .B  #',
  '#  B. #',
  '#  P  #',
  '#     #',
  '#######',
])

const initialState = {
  player: clonePos(levelData.playerStart),
  boxes: clonePositions(levelData.boxes),
}

const state: GameState = {
  mode: 'menu',
  mappingMode: 'world',
  player: clonePos(initialState.player),
  boxes: clonePositions(initialState.boxes),
  history: [],
  moveCount: 0,
}

const TILE_SIZE = 1.8
const STEP_SECONDS = 1 / 60
const REPEAT_DELAY = 0.16
const REPEAT_INTERVAL = 0.1
const HISTORY_LIMIT = 300
const MOVE_DURATION = 0.13
const CAMERA_DAMPING = 10
const CAMERA_MIN_PITCH = 0.45
const CAMERA_MAX_PITCH = 1.25

const wallSet = new Set(levelData.walls.map(toKey))
const goalSet = new Set(levelData.goals.map(toKey))

const floorGeometry = new THREE.BoxGeometry(TILE_SIZE, 0.18, TILE_SIZE)
const wallGeometry = new THREE.BoxGeometry(TILE_SIZE, TILE_SIZE * 0.84, TILE_SIZE)
const goalGeometry = new THREE.CylinderGeometry(TILE_SIZE * 0.24, TILE_SIZE * 0.3, 0.16, 24)
const goalRingGeometry = new THREE.TorusGeometry(TILE_SIZE * 0.34, TILE_SIZE * 0.06, 16, 40)
const boxGeometry = new THREE.BoxGeometry(TILE_SIZE * 0.8, TILE_SIZE * 0.8, TILE_SIZE * 0.8)
const playerGeometry = new THREE.CapsuleGeometry(TILE_SIZE * 0.24, TILE_SIZE * 0.44, 6, 16)
const baseGeometry = new THREE.CylinderGeometry(TILE_SIZE * 4.25, TILE_SIZE * 4.85, TILE_SIZE * 0.5, 40)

const floorMaterials = [
  new THREE.MeshStandardMaterial({ color: 0xf3e8d2, roughness: 0.92, metalness: 0.03 }),
  new THREE.MeshStandardMaterial({ color: 0xe1d4bb, roughness: 0.9, metalness: 0.04 }),
]
const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x24384c, roughness: 0.5, metalness: 0.18 })
const goalMaterial = new THREE.MeshStandardMaterial({
  color: 0xf7bf63,
  roughness: 0.28,
  metalness: 0.52,
  emissive: 0x9a5b03,
  emissiveIntensity: 0.85,
})
const goalRingMaterial = new THREE.MeshStandardMaterial({
  color: 0xffe3b3,
  roughness: 0.2,
  metalness: 0.58,
  emissive: 0x7e4f08,
  emissiveIntensity: 0.55,
})
const boxMaterial = new THREE.MeshStandardMaterial({ color: 0xb46b2e, roughness: 0.45, metalness: 0.16 })
const boxOnGoalMaterial = new THREE.MeshStandardMaterial({
  color: 0x31b36d,
  roughness: 0.32,
  metalness: 0.16,
  emissive: 0x0d552b,
  emissiveIntensity: 0.42,
})
const playerMaterial = new THREE.MeshStandardMaterial({ color: 0x2f74d0, roughness: 0.28, metalness: 0.18 })
const baseMaterial = new THREE.MeshStandardMaterial({ color: 0x12202f, roughness: 0.82, metalness: 0.08 })

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2.2))
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.1
canvasHost.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x8eb7dd)
scene.fog = new THREE.Fog(0x8eb7dd, 18, 40)

const boardGroup = new THREE.Group()
const goalsGroup = new THREE.Group()
const boxesGroup = new THREE.Group()

const arenaBase = new THREE.Mesh(baseGeometry, baseMaterial)
arenaBase.position.set(0, -TILE_SIZE * 0.34, 0)
arenaBase.receiveShadow = true
arenaBase.castShadow = true
scene.add(arenaBase)

const playerMesh = new THREE.Mesh(playerGeometry, playerMaterial)
playerMesh.castShadow = true
scene.add(boardGroup)
scene.add(goalsGroup)
scene.add(boxesGroup)
scene.add(playerMesh)

const boxMeshes: THREE.Mesh[] = []

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200)
const boardSpan = Math.max(levelData.width, levelData.height) * TILE_SIZE
const cameraOrbit: CameraOrbitState = {
  currentYaw: Math.PI / 4,
  targetYaw: Math.PI / 4,
  currentPitch: 0.9,
  targetPitch: 0.9,
  currentRadius: boardSpan * 1.08,
  targetRadius: boardSpan * 1.08,
  dragging: false,
  lastX: 0,
  lastY: 0,
}
const cameraMinRadius = boardSpan * 0.72
const cameraMaxRadius = boardSpan * 1.7

const ambientLight = new THREE.HemisphereLight(0xf3f0de, 0x112134, 1.2)
scene.add(ambientLight)

const sunLight = new THREE.DirectionalLight(0xfff4d8, 1.55)
sunLight.position.set(8, 15, 10)
sunLight.castShadow = true
sunLight.shadow.mapSize.width = 2048
sunLight.shadow.mapSize.height = 2048
sunLight.shadow.camera.near = 1
sunLight.shadow.camera.far = 44
sunLight.shadow.camera.left = -16
sunLight.shadow.camera.right = 16
sunLight.shadow.camera.top = 16
sunLight.shadow.camera.bottom = -16
scene.add(sunLight)

const rimLight = new THREE.PointLight(0x5ea6ff, 2.6, 40, 2)
rimLight.position.set(-8, 5, -6)
scene.add(rimLight)

let playerAnimation: MoveAnimation | null = null
let boxAnimation: BoxAnimation | null = null

buildBoardMeshes()
initDynamicMeshes()
syncDynamicMeshesImmediate()
updateUI()
updateCamera(0, true)
resizeRenderer()

const heldDirections = new Set<MoveToken>()
let repeatingDirection: MoveToken | null = null
let repeatTimer = 0

startButton.addEventListener('click', () => {
  startGame()
})

restartButton.addEventListener('click', () => {
  restartLevel()
})

renderer.domElement.addEventListener('contextmenu', (event) => {
  event.preventDefault()
})

renderer.domElement.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) {
    return
  }
  cameraOrbit.dragging = true
  cameraOrbit.lastX = event.clientX
  cameraOrbit.lastY = event.clientY
  renderer.domElement.setPointerCapture(event.pointerId)
})

renderer.domElement.addEventListener('pointermove', (event) => {
  if (!cameraOrbit.dragging) {
    return
  }
  const dx = event.clientX - cameraOrbit.lastX
  const dy = event.clientY - cameraOrbit.lastY
  cameraOrbit.lastX = event.clientX
  cameraOrbit.lastY = event.clientY

  cameraOrbit.targetYaw -= dx * 0.006
  cameraOrbit.targetPitch = clamp(cameraOrbit.targetPitch - dy * 0.005, CAMERA_MIN_PITCH, CAMERA_MAX_PITCH)
})

renderer.domElement.addEventListener('pointerup', (event) => {
  cameraOrbit.dragging = false
  if (renderer.domElement.hasPointerCapture(event.pointerId)) {
    renderer.domElement.releasePointerCapture(event.pointerId)
  }
})

renderer.domElement.addEventListener('pointercancel', (event) => {
  cameraOrbit.dragging = false
  if (renderer.domElement.hasPointerCapture(event.pointerId)) {
    renderer.domElement.releasePointerCapture(event.pointerId)
  }
})

renderer.domElement.addEventListener('wheel', (event) => {
  event.preventDefault()
  cameraOrbit.targetRadius = clamp(cameraOrbit.targetRadius + event.deltaY * 0.015, cameraMinRadius, cameraMaxRadius)
}, { passive: false })

window.addEventListener('resize', () => {
  resizeRenderer()
})

document.addEventListener('fullscreenchange', () => {
  resizeRenderer()
})

window.addEventListener('keydown', (event) => {
  if ((event.code === 'Enter' || event.code === 'Space') && state.mode === 'menu') {
    startGame()
    event.preventDefault()
    return
  }

  switch (event.code) {
    case 'KeyM':
      toggleMappingMode()
      event.preventDefault()
      return
    case 'KeyZ':
      undoMove()
      event.preventDefault()
      return
    case 'KeyR':
      restartLevel()
      event.preventDefault()
      return
    case 'KeyF':
      void toggleFullscreen()
      event.preventDefault()
      return
    case 'Escape':
      if (document.fullscreenElement) {
        void document.exitFullscreen()
      }
      return
    default:
      break
  }

  const moveToken = eventToMoveToken(event.code)
  if (!moveToken || state.mode !== 'playing') {
    return
  }

  event.preventDefault()
  if (!heldDirections.has(moveToken)) {
    heldDirections.add(moveToken)
    repeatingDirection = moveToken
    if (attemptMove(moveToken)) {
      repeatTimer = REPEAT_DELAY
    }
    return
  }

  repeatingDirection = moveToken
})

window.addEventListener('keyup', (event) => {
  const moveToken = eventToMoveToken(event.code)
  if (!moveToken) {
    return
  }

  heldDirections.delete(moveToken)
  if (repeatingDirection === moveToken) {
    repeatingDirection = heldDirections.values().next().value ?? null
    repeatTimer = REPEAT_INTERVAL
  }
})

window.render_game_to_text = () => {
  return JSON.stringify({
    mode: state.mode,
    coordinateSystem: {
      origin: 'Grid (0,0) at top-left of level',
      x: 'x increases to the right',
      z: 'z increases downward',
    },
    level: {
      width: levelData.width,
      height: levelData.height,
    },
    camera: {
      yawDegrees: Math.round(radiansToDegrees(normalizeRadiansPositive(cameraOrbit.currentYaw))),
      pitchDegrees: Math.round(radiansToDegrees(cameraOrbit.currentPitch)),
      zoomRatio: Number((cameraOrbit.currentRadius / (boardSpan * 1.08)).toFixed(2)),
      mappingMode: state.mappingMode,
    },
    player: clonePos(state.player),
    boxes: sortPositions(state.boxes).map((box) => ({ ...box, onGoal: isGoal(box) })),
    goals: sortPositions(levelData.goals),
    walls: sortPositions(levelData.walls),
    moveCount: state.moveCount,
    isSolved: state.mode === 'won',
  })
}

window.advanceTime = (ms: number) => {
  const steps = Math.max(1, Math.round(ms / (1000 / 60)))
  for (let i = 0; i < steps; i += 1) {
    update(STEP_SECONDS)
  }
  render()
}

let lastFrameTime = performance.now()
const animate = (now: number) => {
  const deltaSeconds = Math.min(0.05, (now - lastFrameTime) / 1000)
  lastFrameTime = now
  update(deltaSeconds)
  render()
  requestAnimationFrame(animate)
}
requestAnimationFrame(animate)

function buildBoardMeshes(): void {
  boardGroup.clear()
  goalsGroup.clear()

  for (let z = 0; z < levelData.height; z += 1) {
    for (let x = 0; x < levelData.width; x += 1) {
      const gridPos: GridPos = { x, z }
      if (isWall(gridPos)) {
        const wallMesh = new THREE.Mesh(wallGeometry, wallMaterial)
        const world = gridToWorld(gridPos)
        wallMesh.position.set(world.x, TILE_SIZE * 0.38, world.z)
        wallMesh.castShadow = true
        wallMesh.receiveShadow = true
        boardGroup.add(wallMesh)
        continue
      }

      const floorMesh = new THREE.Mesh(floorGeometry, floorMaterials[(x + z) % 2])
      const world = gridToWorld(gridPos)
      floorMesh.position.set(world.x, -0.09, world.z)
      floorMesh.receiveShadow = true
      boardGroup.add(floorMesh)

      if (isGoal(gridPos)) {
        const goalMesh = new THREE.Mesh(goalGeometry, goalMaterial)
        goalMesh.position.set(world.x, 0.03, world.z)
        goalMesh.receiveShadow = true
        goalsGroup.add(goalMesh)

        const goalRing = new THREE.Mesh(goalRingGeometry, goalRingMaterial)
        goalRing.rotation.x = Math.PI / 2
        goalRing.position.set(world.x, 0.11, world.z)
        goalRing.receiveShadow = true
        goalsGroup.add(goalRing)
      }
    }
  }
}

function initDynamicMeshes(): void {
  boxesGroup.clear()
  boxMeshes.length = 0
  for (let i = 0; i < state.boxes.length; i += 1) {
    const mesh = new THREE.Mesh(boxGeometry, boxMaterial)
    mesh.castShadow = true
    mesh.receiveShadow = true
    boxesGroup.add(mesh)
    boxMeshes.push(mesh)
  }
}

function syncDynamicMeshesImmediate(): void {
  playerAnimation = null
  boxAnimation = null

  playerMesh.position.copy(getPlayerWorldVector(state.player))
  for (let i = 0; i < boxMeshes.length; i += 1) {
    boxMeshes[i].position.copy(getBoxWorldVector(state.boxes[i]))
    boxMeshes[i].material = isGoal(state.boxes[i]) ? boxOnGoalMaterial : boxMaterial
  }
  updateUI()
}

function updateUI(): void {
  moveChip.textContent = `步数 ${state.moveCount}`
  mappingChip.textContent = `方向 ${state.mappingMode === 'world' ? '世界' : '镜头'}`
  cameraChip.textContent = `视角 ${Math.round(radiansToDegrees(normalizeRadiansPositive(cameraOrbit.currentYaw)))}°`
  tiltChip.textContent = `仰角 ${Math.round(radiansToDegrees(cameraOrbit.currentPitch) - 45)}°`
  zoomChip.textContent = `缩放 ${(cameraOrbit.currentRadius / (boardSpan * 1.08)).toFixed(2)}x`

  const menuHidden = state.mode !== 'menu'
  menuOverlay.classList.toggle('hidden', menuHidden)
  winOverlay.classList.toggle('hidden', state.mode !== 'won')
  winSummary.textContent = `你用了 ${state.moveCount} 步完成本关。`
  hud.dataset.mode = state.mode
}

function updateCamera(deltaSeconds: number, snap: boolean): void {
  if (snap) {
    cameraOrbit.currentYaw = cameraOrbit.targetYaw
    cameraOrbit.currentPitch = cameraOrbit.targetPitch
    cameraOrbit.currentRadius = cameraOrbit.targetRadius
  } else {
    const blend = 1 - Math.exp(-CAMERA_DAMPING * deltaSeconds)
    cameraOrbit.currentYaw = lerp(cameraOrbit.currentYaw, cameraOrbit.targetYaw, blend)
    cameraOrbit.currentPitch = lerp(cameraOrbit.currentPitch, cameraOrbit.targetPitch, blend)
    cameraOrbit.currentRadius = lerp(cameraOrbit.currentRadius, cameraOrbit.targetRadius, blend)
  }

  const horizontal = cameraOrbit.currentRadius * Math.cos(cameraOrbit.currentPitch)
  const vertical = cameraOrbit.currentRadius * Math.sin(cameraOrbit.currentPitch)
  const x = Math.cos(cameraOrbit.currentYaw) * horizontal
  const z = Math.sin(cameraOrbit.currentYaw) * horizontal
  camera.position.set(x, vertical, z)
  camera.lookAt(0, 0.35, 0)
}

function resizeRenderer(): void {
  const width = Math.max(1, canvasHost.clientWidth)
  const height = Math.max(1, canvasHost.clientHeight)
  renderer.setSize(width, height, false)
  camera.aspect = width / height
  camera.updateProjectionMatrix()
  render()
}

function render(): void {
  renderer.render(scene, camera)
}

function startGame(): void {
  if (state.mode === 'menu') {
    state.mode = 'playing'
    updateUI()
  }
}

function restartLevel(): void {
  state.player = clonePos(initialState.player)
  state.boxes = clonePositions(initialState.boxes)
  state.history = []
  state.moveCount = 0
  state.mode = 'playing'
  heldDirections.clear()
  repeatingDirection = null
  repeatTimer = 0
  syncDynamicMeshesImmediate()
}

function undoMove(): void {
  const snapshot = state.history.pop()
  if (!snapshot) {
    return
  }
  state.player = clonePos(snapshot.player)
  state.boxes = clonePositions(snapshot.boxes)
  state.moveCount = snapshot.moveCount
  state.mode = 'playing'
  syncDynamicMeshesImmediate()
}

function toggleMappingMode(): void {
  state.mappingMode = state.mappingMode === 'world' ? 'camera' : 'world'
  updateUI()
}

async function toggleFullscreen(): Promise<void> {
  if (!document.fullscreenElement) {
    await gameShell.requestFullscreen()
    return
  }
  await document.exitFullscreen()
}

function update(deltaSeconds: number): void {
  updateCamera(deltaSeconds, false)
  tickMoveAnimation(deltaSeconds)

  if (state.mode !== 'playing' || hasActiveAnimation()) {
    updateUI()
    return
  }

  if (!repeatingDirection || !heldDirections.has(repeatingDirection)) {
    updateUI()
    return
  }

  repeatTimer -= deltaSeconds
  if (repeatTimer > 0) {
    updateUI()
    return
  }

  if (attemptMove(repeatingDirection)) {
    repeatTimer += REPEAT_INTERVAL
  } else {
    repeatTimer += REPEAT_INTERVAL
  }

  updateUI()
}

function tickMoveAnimation(deltaSeconds: number): void {
  if (playerAnimation) {
    playerAnimation.elapsed += deltaSeconds
    const t = clamp(playerAnimation.elapsed / playerAnimation.duration, 0, 1)
    playerMesh.position.lerpVectors(playerAnimation.from, playerAnimation.to, easeOutCubic(t))
    if (t >= 1) {
      playerAnimation = null
    }
  } else {
    playerMesh.position.copy(getPlayerWorldVector(state.player))
  }

  for (let i = 0; i < boxMeshes.length; i += 1) {
    const mesh = boxMeshes[i]
    if (boxAnimation && boxAnimation.index === i) {
      boxAnimation.elapsed += deltaSeconds
      const t = clamp(boxAnimation.elapsed / boxAnimation.duration, 0, 1)
      mesh.position.lerpVectors(boxAnimation.from, boxAnimation.to, easeOutCubic(t))
      if (t >= 1) {
        boxAnimation = null
      }
    } else {
      mesh.position.copy(getBoxWorldVector(state.boxes[i]))
    }
    mesh.material = isGoal(state.boxes[i]) ? boxOnGoalMaterial : boxMaterial
  }
}

function hasActiveAnimation(): boolean {
  return playerAnimation !== null || boxAnimation !== null
}

function attemptMove(moveToken: MoveToken): boolean {
  if (state.mode !== 'playing' || hasActiveAnimation()) {
    return false
  }

  const direction = resolveMove(moveToken)
  const nextPos: GridPos = { x: state.player.x + direction.x, z: state.player.z + direction.z }

  if (isWall(nextPos)) {
    return false
  }

  const previousPlayer = clonePos(state.player)
  const blockingBoxIndex = findBoxIndex(nextPos)

  if (blockingBoxIndex === -1) {
    pushHistory()
    state.player = nextPos
    state.moveCount += 1
    beginMovementAnimation(previousPlayer, nextPos)
    completeMove()
    return true
  }

  const pushTarget: GridPos = { x: nextPos.x + direction.x, z: nextPos.z + direction.z }
  if (isWall(pushTarget) || findBoxIndex(pushTarget) !== -1) {
    return false
  }

  const previousBox = clonePos(state.boxes[blockingBoxIndex])
  pushHistory()
  state.boxes[blockingBoxIndex] = pushTarget
  state.player = nextPos
  state.moveCount += 1
  beginMovementAnimation(previousPlayer, nextPos, blockingBoxIndex, previousBox, pushTarget)
  completeMove()
  return true
}

function beginMovementAnimation(
  previousPlayer: GridPos,
  nextPlayer: GridPos,
  boxIndex?: number,
  previousBox?: GridPos,
  nextBox?: GridPos,
): void {
  playerAnimation = {
    from: getPlayerWorldVector(previousPlayer),
    to: getPlayerWorldVector(nextPlayer),
    elapsed: 0,
    duration: MOVE_DURATION,
  }

  if (boxIndex === undefined || !previousBox || !nextBox) {
    boxAnimation = null
    return
  }

  boxAnimation = {
    index: boxIndex,
    from: getBoxWorldVector(previousBox),
    to: getBoxWorldVector(nextBox),
    elapsed: 0,
    duration: MOVE_DURATION,
  }
}

function completeMove(): void {
  if (isSolved()) {
    state.mode = 'won'
    heldDirections.clear()
    repeatingDirection = null
  }
}

function pushHistory(): void {
  state.history.push({
    player: clonePos(state.player),
    boxes: clonePositions(state.boxes),
    moveCount: state.moveCount,
  })
  if (state.history.length > HISTORY_LIMIT) {
    state.history.shift()
  }
}

function isSolved(): boolean {
  return state.boxes.every((box) => isGoal(box))
}

function findBoxIndex(pos: GridPos): number {
  return state.boxes.findIndex((box) => box.x === pos.x && box.z === pos.z)
}

function isWall(pos: GridPos): boolean {
  return wallSet.has(toKey(pos))
}

function isGoal(pos: GridPos): boolean {
  return goalSet.has(toKey(pos))
}

function resolveMove(moveToken: MoveToken): GridPos {
  const baseMove = moveTokenToVector(moveToken)
  if (state.mappingMode === 'world') {
    return baseMove
  }
  return rotateClockwise(baseMove, getCameraQuarterTurnsForMapping())
}

function getCameraQuarterTurnsForMapping(): number {
  const baselineYaw = Math.PI / 4
  const delta = normalizeRadians(cameraOrbit.currentYaw - baselineYaw)
  const turns = Math.round(delta / (Math.PI / 2))
  return normalizeQuarterTurns(turns)
}

function moveTokenToVector(moveToken: MoveToken): GridPos {
  switch (moveToken) {
    case 'up':
      return { x: 0, z: -1 }
    case 'down':
      return { x: 0, z: 1 }
    case 'left':
      return { x: -1, z: 0 }
    case 'right':
      return { x: 1, z: 0 }
  }
}

function rotateClockwise(vec: GridPos, quarterTurns: number): GridPos {
  let x = vec.x
  let z = vec.z
  for (let i = 0; i < quarterTurns; i += 1) {
    const nextX = -z
    const nextZ = x
    x = nextX
    z = nextZ
  }
  return { x, z }
}

function eventToMoveToken(code: string): MoveToken | null {
  switch (code) {
    case 'ArrowUp':
    case 'KeyW':
      return 'up'
    case 'ArrowDown':
    case 'KeyS':
      return 'down'
    case 'ArrowLeft':
    case 'KeyA':
      return 'left'
    case 'ArrowRight':
    case 'KeyD':
      return 'right'
    default:
      return null
  }
}

function gridToWorld(pos: GridPos): GridPos {
  const halfWidth = (levelData.width - 1) / 2
  const halfHeight = (levelData.height - 1) / 2
  return {
    x: (pos.x - halfWidth) * TILE_SIZE,
    z: (pos.z - halfHeight) * TILE_SIZE,
  }
}

function getPlayerWorldVector(pos: GridPos): THREE.Vector3 {
  const world = gridToWorld(pos)
  return new THREE.Vector3(world.x, TILE_SIZE * 0.45, world.z)
}

function getBoxWorldVector(pos: GridPos): THREE.Vector3 {
  const world = gridToWorld(pos)
  return new THREE.Vector3(world.x, TILE_SIZE * 0.4, world.z)
}

function buildLevelData(rows: string[]): LevelData {
  if (rows.length === 0) {
    throw new Error('Level rows are empty')
  }

  const width = rows[0].length
  const walls: GridPos[] = []
  const goals: GridPos[] = []
  const boxes: GridPos[] = []
  let playerStart: GridPos | null = null

  rows.forEach((row, z) => {
    if (row.length !== width) {
      throw new Error('All level rows must have equal width')
    }

    for (let x = 0; x < row.length; x += 1) {
      const ch = row[x]
      if (ch === '#') {
        walls.push({ x, z })
        continue
      }
      if (ch === '.') {
        goals.push({ x, z })
        continue
      }
      if (ch === 'B') {
        boxes.push({ x, z })
        continue
      }
      if (ch === 'P') {
        playerStart = { x, z }
        continue
      }
      if (ch === '*') {
        goals.push({ x, z })
        boxes.push({ x, z })
        continue
      }
      if (ch === '+') {
        goals.push({ x, z })
        playerStart = { x, z }
        continue
      }
      if (ch === ' ') {
        continue
      }
      throw new Error(`Unsupported level character "${ch}" at (${x}, ${z})`)
    }
  })

  if (!playerStart) {
    throw new Error('Level is missing player start position')
  }

  return {
    width,
    height: rows.length,
    walls,
    goals,
    boxes,
    playerStart,
  }
}

function sortPositions(positions: GridPos[]): GridPos[] {
  return [...positions].sort((a, b) => {
    if (a.z !== b.z) {
      return a.z - b.z
    }
    return a.x - b.x
  })
}

function clonePositions(positions: GridPos[]): GridPos[] {
  return positions.map((pos) => clonePos(pos))
}

function clonePos(pos: GridPos): GridPos {
  return { x: pos.x, z: pos.z }
}

function toKey(pos: GridPos): string {
  return `${pos.x},${pos.z}`
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3
}

function normalizeQuarterTurns(turns: number): number {
  return ((turns % 4) + 4) % 4
}

function normalizeRadians(value: number): number {
  const tau = Math.PI * 2
  let output = value
  while (output <= -Math.PI) {
    output += tau
  }
  while (output > Math.PI) {
    output -= tau
  }
  return output
}

function normalizeRadiansPositive(value: number): number {
  const tau = Math.PI * 2
  let output = value % tau
  if (output < 0) {
    output += tau
  }
  return output
}

function radiansToDegrees(value: number): number {
  return (value * 180) / Math.PI
}

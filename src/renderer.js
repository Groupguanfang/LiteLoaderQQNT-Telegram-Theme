const pluginPath = LiteLoader.plugins['telegram_theme'].path.plugin

const enableLog = false
const enableError = false
const log = (...args) => {
    if (enableLog) {
        console.log('[telegram-theme]', ...args)
        telegram_theme.logToMain(...args)
    }
}

const error = (...args) => {
    if (enableError) {
        console.error('[telegram-theme]', ...args)
        telegram_theme.errorToMain(...args)
    }
}

const debounce = (fn, time = 100) => {
    let timer = null
    return (...args) => {
        timer && clearTimeout(timer)
        timer = setTimeout(() => {
            fn.apply(this, args)
        }, time)
    }
}

const waitForEle = (selector, callback, interval = 100) => {
    const timer = setInterval(() => {
        if (document.querySelector(selector)) {
            log(`waitForEle ${selector} EXIST`)
            if (typeof callback === 'function') {
                callback()
            }
            clearInterval(timer)
        }
    }, interval)
}

class IPC {
    // 获取全部设置
    static async getSetting() {
        try {
            return await telegram_theme.getSetting()
        } catch (err) {
            error(`getSetting error`, err.toString())
            return null
        }
    }

    // 告知main更新设置
    static setSetting(k, v) {
        try {
            telegram_theme.setSetting(k.toString(), v.toString())
        } catch (err) {
            error(`setSetting error`, err.toString())
        }
    }

    // 选择图片
    static chooseImage() {
        telegram_theme.chooseImage()
    }

    static debounceSetSetting = debounce((k, v) => {
        this.setSetting(k, v)
    }, 100)

    // 监听设置更新
    static updateSetting() {
        telegram_theme.updateSetting((event, k, v) => {
            // channel.postMessage({ 'k': k, 'v': v })
            document.body.style.setProperty(k, v)
            // log('updateSetting', k, v)
        })
    }

    // 监听全部设置更新（切换主题）
    static updateAllSetting() {
        telegram_theme.updateAllSetting(async (event, theme) => {
            log('theme change', theme, 'updateAllCSS start')
            await updateAllCSS()
        })
    }
}

// 更新html body中全部自定义CSS变量
const updateAllCSS = async () => {
    const setting = await IPC.getSetting()
    for (const k in setting) {
        const v = setting[k]['value']
        if (v) {
            // log(`updateAllCSS: ${k}----${v}`)
            document.body.style.setProperty(k, v)
        }
    }
    log('updateAllCSS OK')
}

// 调节会话列表宽度
const adjustContactWidth = () => {
    if (!location.hash.includes('#/main')) {
        return
    }

    log('run adjustContactWidth')

    try {
        const overrideWidth = (resetWidth) => {
            const layoutAside = document.querySelector('.two-col-layout__aside')
            const layoutMain = document.querySelector('.two-col-layout__main')
            const oldResizeHandler = document.querySelector('.two-col-layout__aside .resize-handler')

            if (oldResizeHandler && layoutAside && layoutMain) {
                // 等待QQ赋予aside属性
                let count = 0
                const timer = setInterval(() => {
                    const computedStyle = window.getComputedStyle(layoutAside)
                    if (
                        computedStyle.getPropertyValue('--min-width-aside') ||
                        computedStyle.getPropertyValue('--max-width-aside') ||
                        computedStyle.getPropertyValue('--drag-width-aside') ||
                        computedStyle.getPropertyValue('--default-width-aside')
                    ) {
                        // QQ已完成自定义宽度赋值，覆盖掉
                        const resizeHandler = oldResizeHandler.cloneNode(true)
                        if (!resizeHandler || !oldResizeHandler.parentNode) {
                            return
                        }
                        oldResizeHandler.parentNode.replaceChild(resizeHandler, oldResizeHandler)

                        // 调大默认长度, 重写事件
                        layoutAside.style.setProperty('--min-width-aside', '78px')
                        layoutAside.style.setProperty('--max-width-aside', '50vw')
                        layoutAside.style.setProperty('--default-width-aside', '300px')
                        if (resetWidth) {
                            layoutAside.style.setProperty('--drag-width-aside', '300px')
                            layoutAside.style.width = '300px'
                            layoutAside.style.flexBasis = '300px'
                        }
                        let isResizing = false
                        let startX = 0
                        let startWidth = 0

                        resizeHandler.addEventListener('mousedown', (event) => {
                            isResizing = true
                            startX = event.clientX
                            startWidth = parseFloat(getComputedStyle(layoutAside).width)
                        })
                        document.addEventListener('mousemove', (event) => {
                            if (!isResizing) {
                                return
                            }
                            const width = startWidth + event.clientX - startX
                            layoutAside.style.flexBasis = width + 'px'
                            layoutAside.style.width = width + 'px'
                            layoutAside.style.setProperty('--drag-width-aside', `${width}px`)
                        })
                        document.addEventListener('mouseup', () => {
                            if (!isResizing) {
                                return
                            }
                            isResizing = false
                        })
                        clearInterval(timer)
                    }
                    count++
                    if (count > 50) {
                        clearInterval(timer)
                    }
                }, 100)
            }
        }

        overrideWidth(true)

        // 监听窗口调节
        window.addEventListener('resize', () => {
            const task = setInterval(() => {
                const mainLayout = document.querySelector('.two-col-layout__main')
                if (getComputedStyle(mainLayout).display !== 'none') {
                    overrideWidth(false)
                }
                clearInterval(task)
            }, 50)
        })
    } catch (err) {
        error('adjustContactWidth error', err.toString())
    }
}

// key为num str的Cache
class LimitedMap {
    maxSize = 0
    m = new Map()
    constructor(maxSize) {
        this.maxSize = maxSize
    }
    get(k) {
        return this.m.get(k)
    }
    set(k, v) {
        this.m.set(k, v)
        if (this.m.size > this.maxSize) {
            this.free()
        }
    }
    has(k) {
        return this.m.has(k)
    }
    async free() {
        try {
            const keys = Array.from(this.m.keys())
                .sort((a, b) => parseInt(a) - parseInt(b))
                .slice(0, Math.floor(this.maxSize / 4))
            keys.forEach((k) => this.m.delete(k))
        } catch {
            // err
        }
    }
}

// 仿Telegram，拼接消息，头像浮动
const concatMsg = () => {
    const msgList = document.querySelector('#ml-root .ml-list')
    if (!msgList) {
        return
    }
    const infoCache = new LimitedMap(20000)

    const work = () => {
        let msgs = msgList.querySelectorAll('.ml-item')

        const msgCnt = msgs.length
        const nameArr = new Array(msgCnt)
        const selfArr = new Array(msgCnt)
        const grayArr = new Array(msgCnt)
        const timeArr = new Array(msgCnt)

        // 1. 获取、补齐信息
        const getInfo = (index) => {
            const msg = msgs[index]
            const id = msg.id
            if (!infoCache.has(id)) {
                // 用户名、是否为自己消息、是否含时间戳、是否为灰色消息(撤回or管理操作)
                let name, self, time
                const gray = !!msg.querySelector('.gray-tip-message')
                if (gray) {
                    name = null
                    self = false
                    time = false
                } else {
                    name = msg.querySelector('.user-name .text-ellipsis')?.innerHTML
                    self = !!msg.querySelector('.message-container--self')
                    time = !!msg.querySelector('.message__timestamp')
                }
                nameArr[index] = name
                selfArr[index] = self
                grayArr[index] = gray
                timeArr[index] = time
                infoCache.set(id, {
                    name: name,
                    self: self,
                    gray: gray,
                    time: time,
                })
            } else {
                const info = infoCache.get(id)
                nameArr[index] = info.name
                selfArr[index] = info.self
                grayArr[index] = info.gray
                timeArr[index] = info.time
            }
        }
        for (let i = 0; i < msgCnt; i++) {
            getInfo(i)
        }

        // 2. 计算消息断点
        const typeArr = new Array(msgCnt)
        const sepArr = new Array(msgCnt)
        for (let i = 0; i < msgCnt - 1; i++) {
            // 出现时间戳 / 出现gray消息 / 位置变化 / 用户名变化
            if (timeArr[i]) {
                sepArr[i] = true
            }
            if (grayArr[i] && i > 0) {
                sepArr[i - 1] = true
            }
            if (nameArr[i] !== nameArr[i + 1] || selfArr[i] !== selfArr[i + 1]) {
                sepArr[i] = true
            }
        }
        sepArr[msgCnt - 1] = true // 最后节点

        let start = 0
        let end
        for (end = 0; end < sepArr.length; end++) {
            if (sepArr[end]) {
                // 连续消息区间
                const head = end
                const tail = start
                if (head === tail) {
                    typeArr[head] = selfArr[head] ? 'self-single' : 'others-single'
                } else {
                    typeArr[tail] = selfArr[tail] ? 'self-tail' : 'others-tail'
                    for (let body = tail + 1; body < head; body++) {
                        typeArr[body] = selfArr[body] ? 'self-body' : 'others-body'
                    }
                    typeArr[head] = selfArr[head] ? 'self-head' : 'others-head'
                }
                start = end + 1
            }
        }

        // 3. 高度计算
        const heightArr = new Array(msgCnt)
        let sumIndex = 0
        let sumHeight = 0
        for (let i = 0; i < msgCnt; i++) {
            if (typeArr[i] === 'others-tail') {
                sumHeight = 0
                sumIndex = i
            }
            if (['others-head', 'others-body', 'others-tail'].includes(typeArr[i])) {
                const msg = msgs[i].querySelector('.message-content__wrapper')
                if (msg) {
                    sumHeight += msg.offsetHeight + 3
                }
            }
            if (typeArr[i] === 'others-head') {
                heightArr[sumIndex] = sumHeight
            }
        }

        // 4. rAF统一修改style，给.ml-item赋予属性，修改头像浮动height
        requestAnimationFrame(() => {
            for (let i = 0; i < msgCnt; i++) {
                if (typeArr[i]) {
                    msgs[i].setAttribute('class', `ml-item ${typeArr[i]}`)
                }
                if (heightArr[i]) {
                    const avatar = msgs[i].querySelector('.avatar-span')
                    if (avatar) {
                        avatar.style.height = `${heightArr[i] + 20}px`
                    }
                }
            }
        })
    }

    const observer = new MutationObserver(async (mutationList) => {
        // 不处理私聊，纯CSS解决
        if (!msgList.querySelector('.user-name')) {
            return
        }
        for (let i = 0; i < mutationList.length; i++) {
            if (mutationList[i].addedNodes.length > 0) {
                try {
                    work()
                } catch {
                    // error(err)
                }
                return
            }
        }
    })
    observer.observe(msgList, { childList: true })
}

// BroadcastChannel，renderer不同页面间通信，用于实时同步设置
const channel = new BroadcastChannel('telegram_renderer')

// 聊天窗口创建
const onMessageCreate = async () => {
    log('onMessageCreate start')
    // 插入主题CSS
    if (!document.head?.querySelector('.telegram-css')) {
        const link = document.createElement('link')
        link.type = 'text/css'
        link.rel = 'stylesheet'
        link.classList.add('telegram-css')
        link.href = `local:///${pluginPath.replaceAll('\\', '/')}/src/style/telegram.css`
        document.head.appendChild(link)
        log('insert telegram css, OK')
    }

    // 监听设置更新
    IPC.updateSetting()
    IPC.updateAllSetting()

    // 更新CSS
    waitForEle('body', updateAllCSS)
    // 调节宽度
    waitForEle('.two-col-layout__aside .resize-handler', adjustContactWidth, 1000)
    // 拼接消息，头像浮动
    waitForEle('#ml-root .ml-list', concatMsg, 500)

    channel.onmessage = (event) => {
        if (['#/main/message', '#/main/contact/profile', '#/chat'].includes(location.hash)) {
            try {
                const k = event.data['k']
                const v = event.data['v']
                document.body.style.setProperty(k, v)
                // log('set body style', k, v)
            } catch (err) {
                error('channel.onmessage error', err)
            }
        }
    }
    log('onMessageCreate, OK')
}

try {
    if (location.pathname === '/renderer/index.html') {
        if (location.hash === '#/blank') {
            navigation.addEventListener(
                'navigatesuccess',
                () => {
                    if (location.hash.includes('#/main') || location.hash.includes('#/chat')) {
                        onMessageCreate()
                    }
                },
                { once: true },
            )
        } else if (location.hash.includes('#/main') || location.hash.includes('#/chat')) {
            onMessageCreate()
        }
    }
} catch (err) {
    error('main, ERROR', err.toString())
}

////////////////////////////////////////////////////////////////////////////////////////////////////

// 设置组件：颜色选择
class ColorPickerItem {
    nodeHTML = `
    <setting-item data-direction="row" class="telegram-color-picker">
        <div class="col-info">
            <div class="info-title">主标题</div>
            <div class="info-description">功能描述</div>
        </div>
        <div class="col-color">
            <input type="color" value="#FFFFFF" class="color-picker">
        </div>
        <div class="col-opacity">
            <input type="range" value="100" min="0" max="100" step="1" class="opacity-picker">
        </div>
        <div class="col-reset">
            <button class="reset-btn" type="button">重置</button>
        </div>
    </setting-item>
    `

    constructor(itemKey, itemValue, defaultValue, title, description) {
        this.itemKey = itemKey
        // value为hex color, 6位or8位, 必须以#开头
        this.itemValue = itemValue
        this.defaultValue = defaultValue
        this.title = title
        this.description = description
    }

    getItem() {
        let nodeEle = document.createElement('div')
        nodeEle.innerHTML = this.nodeHTML.trim()
        nodeEle = nodeEle.querySelector('setting-item')

        const title = nodeEle.querySelector('.info-title')
        const description = nodeEle.querySelector('.info-description')
        const opacityPicker = nodeEle.querySelector('input.opacity-picker')
        const colorPicker = nodeEle.querySelector('input.color-picker')
        const resetBtn = nodeEle.querySelector('button.reset-btn')

        if (!(opacityPicker && colorPicker && title && description && resetBtn)) {
            error('ColorPickerItem getItem querySelector error')
            return undefined
        }
        // 设定文字
        title.innerHTML = this.title
        description.innerHTML = this.description
        // 设定colorPicker初始值
        const hexColor = this.itemValue.slice(0, 7)
        const hexColorDefault = this.defaultValue.slice(0, 7)
        colorPicker.setAttribute('value', hexColor)
        colorPicker.setAttribute('defaultValue', hexColorDefault)
        // 设定opacityPicker初始值
        let opacity = this.itemValue.slice(7, 9)
        if (!opacity) {
            opacity = 'ff'
        }
        let opacityDefault = this.defaultValue.slice(7, 9)
        if (!opacityDefault) {
            opacityDefault = 'ff'
        }
        opacityPicker.setAttribute('value', `${(parseInt(opacity, 16) / 255) * 100}`)
        opacityPicker.setAttribute('defaultValue', `${(parseInt(opacityDefault, 16) / 255) * 100}`)
        opacityPicker.style.setProperty('--opacity-0', `${hexColor}00`)
        opacityPicker.style.setProperty('--opacity-100', `${hexColor}ff`)

        // 监听颜色修改
        colorPicker.addEventListener('input', (event) => {
            const hexColor = event.target.value.toLowerCase()
            const numOpacity = opacityPicker.value
            const hexOpacity = Math.round((numOpacity / 100) * 255)
                .toString(16)
                .padStart(2, '0')
                .toLowerCase()

            // 设定透明度bar的透明色和不透明色
            opacityPicker.style.setProperty('--opacity-0', `${hexColor}00`)
            opacityPicker.style.setProperty('--opacity-100', `${hexColor}ff`)
            // 修改message页面的body style
            const colorWithOpacity = hexColor + hexOpacity
            channel.postMessage({ k: this.itemKey, v: colorWithOpacity })
            // 保存设置
            IPC.debounceSetSetting(this.itemKey, colorWithOpacity)
            // log(`colorPicker set body style, ${this.itemKey} : ${colorWithOpacity}`)
        })

        // 监听透明度修改
        opacityPicker.addEventListener('input', (event) => {
            const numOpacity = event.target.value
            const hexOpacity = Math.round((numOpacity / 100) * 255)
                .toString(16)
                .padStart(2, '0')
                .toLowerCase()

            // 设定透明度bar的透明色和不透明色
            const hexColor = colorPicker.value.toLowerCase()
            opacityPicker.style.setProperty('--opacity-0', `${hexColor}00`)
            opacityPicker.style.setProperty('--opacity-100', `${hexColor}ff`)
            // 修改message页面的body style
            const colorWithOpacity = hexColor + hexOpacity
            channel.postMessage({ k: this.itemKey, v: colorWithOpacity })
            // 保存设置
            IPC.debounceSetSetting(this.itemKey, colorWithOpacity)
            // log(`colorPicker set body style, ${this.itemKey} : ${colorWithOpacity}`)
        })

        // 监听重置
        resetBtn.onclick = () => {
            opacityPicker.value = opacityPicker.getAttribute('defaultValue')
            colorPicker.value = colorPicker.getAttribute('defaultValue')
            const event = new Event('input', { bubbles: true })
            opacityPicker.dispatchEvent(event)
            colorPicker.dispatchEvent(event)
        }

        return nodeEle
    }
}

// 设置组件：文字输入框
class TextItem {
    nodeHTML = `
    <setting-item data-direction="row" class="telegram-text-input">
        <div class="col-info">
            <div class="info-title">主标题</div>
            <div class="info-description">功能描述</div>
        </div>
        <div class="col-text">
            <input type="text" value="" class="text-input">
        </div>
        <div class="col-reset">
            <button class="reset-btn" type="button">重置</button>
        </div>
    </setting-item>
    `

    constructor(itemKey, itemValue, defaultValue, title, description) {
        this.itemKey = itemKey
        this.itemValue = itemValue
        this.defaultValue = defaultValue
        this.title = title
        this.description = description
    }

    getItem() {
        let nodeEle = document.createElement('div')
        nodeEle.innerHTML = this.nodeHTML.trim()
        nodeEle = nodeEle.querySelector('setting-item')

        const title = nodeEle.querySelector('.info-title')
        const description = nodeEle.querySelector('.info-description')
        const textInput = nodeEle.querySelector('input.text-input')
        const resetBtn = nodeEle.querySelector('button.reset-btn')

        if (!(textInput && title && description && resetBtn)) {
            error('TextItem getItem querySelector error')
            return undefined
        }
        title.innerHTML = this.title
        description.innerHTML = this.description
        textInput.setAttribute('value', this.itemValue)
        textInput.setAttribute('defaultValue', this.defaultValue)

        // 监听输入
        textInput.addEventListener('input', (event) => {
            const newValue = event.target.value
            // 修改message页面的body style
            channel.postMessage({ k: this.itemKey, v: newValue })
            // 保存设置
            IPC.debounceSetSetting(this.itemKey, newValue)
            // log(`textInput set body style, ${this.itemKey} : ${newValue}`)
        })

        // 监听重置
        resetBtn.onclick = () => {
            textInput.value = textInput.getAttribute('defaultValue')
            const event = new Event('input', { bubbles: true })
            textInput.dispatchEvent(event)
        }
        return nodeEle
    }
}

// 设置组件：图片选择按钮
class ImageBtnItem {
    nodeHTML = `
    <setting-item data-direction="row" class="telegram-button">
        <div class="col-info">
            <div class="info-title">主标题</div>
            <div class="info-description">功能描述</div>
        </div>
        <div class="col-button">
            <button class="image-btn" type="button">选择图片</button>
        </div>
    </setting-item>
    `

    constructor(itemKey, title, description, callback) {
        this.itemKey = itemKey
        this.title = title
        this.description = description
        this.callback = callback
    }

    getItem() {
        let nodeEle = document.createElement('div')
        nodeEle.innerHTML = this.nodeHTML.trim()
        nodeEle = nodeEle.querySelector('setting-item')

        const title = nodeEle.querySelector('.info-title')
        const description = nodeEle.querySelector('.info-description')
        const button = nodeEle.querySelector('button.image-btn')

        if (!(button && title && description)) {
            error('ImageBtnItem getItem querySelector error')
            return undefined
        }
        title.innerHTML = this.title
        description.innerHTML = this.description
        button.onclick = () => {
            this.callback()
        }

        return nodeEle
    }
}

// 设置组件：一组item
class SettingList {
    nodeHTML = `
    <setting-list data-direction="column" is-collapsible="" data-title="">
    </setting-list>
    `

    constructor(listTitle, settingItems = []) {
        this.listTitle = listTitle
        this.settingItems = settingItems
    }

    createNode(view) {
        let nodeEle = document.createElement('div')
        nodeEle.innerHTML = this.nodeHTML
        nodeEle = nodeEle.querySelector('setting-list')
        nodeEle.setAttribute('data-title', this.listTitle)

        this.settingItems.forEach((item) => {
            nodeEle.appendChild(item)
        })
        view.appendChild(nodeEle)
    }
}

// 创建设置页流程
const onSettingCreate = async (view) => {
    try {
        // 插入设置页CSS
        if (!view.querySelector('.telegram-setting-css')) {
            const link = document.createElement('link')
            link.type = 'text/css'
            link.rel = 'stylesheet'
            link.classList.add('telegram-setting-css')
            link.href = `local:///${pluginPath.replaceAll('\\', '/')}/src/style/telegram-setting.css`
            view.appendChild(link)
        }

        // 获取设置，创建item列表
        const setting = await IPC.getSetting()
        if (!setting || setting.length === 0) {
            throw Error('getSetting error')
        }
        const settingItemLists = {
            壁纸设定: [],
            自己的消息: [],
            他人的消息: [],
            会话列表: [],
            侧边栏: [],
            其他设定: [],
        }
        for (const key in setting) {
            const v = setting[key]
            const value = v['value']
            const title = v['title']
            const defaultValue = v['defaultValue']
            const description = v['description']
            const type = v['type']
            const group = v['group']

            if (type === 'color') {
                const colorPickerItem = new ColorPickerItem(key, value, defaultValue, title, description).getItem()
                if (colorPickerItem) {
                    settingItemLists[group]?.push(colorPickerItem)
                }
            } else if (type === 'text') {
                const textInputItem = new TextItem(key, value, defaultValue, title, description).getItem()
                if (textInputItem) {
                    settingItemLists[group]?.push(textInputItem)
                }
            } else if (type === 'button') {
                const imageBtnItem = new ImageBtnItem(key, title, description, () => {
                    IPC.chooseImage()
                }).getItem()
                if (imageBtnItem) {
                    settingItemLists[group]?.push(imageBtnItem)
                }
            }
        }

        for (const listTitle in settingItemLists) {
            new SettingList(listTitle, settingItemLists[listTitle]).createNode(view)
            log(`create list ${listTitle}, ${settingItemLists[listTitle].length} items`)
        }
    } catch (err) {
        error('onSettingCreate, error', err.toString())
    }
}

// 打开设置界面时触发
export const onSettingWindowCreated = (view) => {
    onSettingCreate(view)
}

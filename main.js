import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced, saveChat, eventSource, event_types } from "../../../../script.js";
import { debounce } from "../../../utils.js";

const extensionName = "Chapterizer";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

// --- 전역 상태 변수 ---
let chapterData = [];
let selectedMessages = [];
const DATA_KEY = 'chapterizer_data';

// --- 설정 관리 ---
const defaultSettings = {
    isEnabled: true,
    isSelectModeActive: false,
    lastUsedTitleBgColor: '#FF007F',
    lastUsedTitleColor: '#FFFFFF',
};

function getSettings() {
    if (!extension_settings[extensionName]) {
        extension_settings[extensionName] = { ...defaultSettings };
    }
    Object.keys(defaultSettings).forEach(key => {
        if (extension_settings[extensionName][key] === undefined) {
            extension_settings[extensionName][key] = defaultSettings[key];
        }
    });
    return extension_settings[extensionName];
}

function saveSettings() { saveSettingsDebounced(); }

// --- 핵심 데이터 관리 (message.extra 사용) ---

function loadChapters() {
    const context = getContext();

    if (!context?.chat?.[0]) {
        chapterData = [];
        updateFullUI();
        return;
    }

    const firstMessage = context.chat[0];
    const rawData = firstMessage.extra?.[DATA_KEY];

    if (rawData) {
        try {
            const parsedData = JSON.parse(rawData);
            if (Array.isArray(parsedData)) {
                chapterData = parsedData;
            } else {
                throw new Error("Data is not an array");
            }
        } catch (error) {
            console.error("[Chapterizer] Failed to parse chapter data:", error);
            chapterData = [];
        }
    } else {
        chapterData = [];
    }
    
    if (getSettings().isSelectModeActive) {
        getSettings().isSelectModeActive = false;
        saveSettings();
        updateSelectModeUI();
    }
    clearSelections();
    updateFullUI();
}

async function saveChapters() {
    const context = getContext();

    if (!context?.chat?.[0]) {
        return;
    }

    const firstMessage = context.chat[0];
    if (!firstMessage.extra) {
        firstMessage.extra = {};
    }

    firstMessage.extra[DATA_KEY] = JSON.stringify(chapterData);
    
    try {
        await saveChat();
    } catch (error) {
        console.error("[Chapterizer] Failed to save chat:", error);
    }
}

function getAllMessageIds() {
    return $('.mes')
        .map((_, el) => Number(el.getAttribute('mesid')))
        .get()
        .filter(id => Number.isFinite(id))
        .sort((a, b) => a - b);
}

function recalculateChapterBounds() {
    if (!Array.isArray(chapterData) || chapterData.length === 0) return;

    const messageIds = getAllMessageIds();
    if (messageIds.length === 0) return;

    const lastMessageId = messageIds[messageIds.length - 1];
    const sortedChapters = [...chapterData].sort((a, b) => a.start - b.start);

    sortedChapters.forEach((chapter, index) => {
        const normalizedStart = Number(chapter.start);
        chapter.start = Number.isFinite(normalizedStart) ? normalizedStart : 0;

        const nextChapter = sortedChapters[index + 1];
        let calculatedEnd = lastMessageId;

        if (nextChapter) {
            const nextStart = Number(nextChapter.start);
            if (Number.isFinite(nextStart) && nextStart > chapter.start) {
                calculatedEnd = nextStart - 1;
            } else {
                calculatedEnd = chapter.start;
            }
        }

        if (!Number.isFinite(calculatedEnd)) {
            calculatedEnd = chapter.start;
        }

        chapter.end = Math.max(calculatedEnd, chapter.start);
    });

    chapterData = sortedChapters;
}

function resolveChapterEnd(chapter) {
    if (!chapter) return null;
    const numericEnd = Number(chapter.end);
    if (!Number.isFinite(numericEnd)) return chapter.start;
    return Math.max(numericEnd, chapter.start);
}

// --- UI 및 렌더링 ---

function updateFullUI() {
    recalculateChapterBounds();
    renderChapters();
    renderChapterIndex();
    const shouldShowIndex = getSettings().isEnabled && chapterData && chapterData.length > 0;
    $('#chapterizer-index-toggle-btn').toggle(shouldShowIndex);
}

const debouncedUpdateUI = debounce(updateFullUI, 200);

function pad(num, size) {
    return num.toString().padStart(size, '0');
}

function renderChapters() {
    $('.chapterizer-header').remove();

    if (!getSettings().isEnabled || !chapterData || chapterData.length === 0) {
        return;
    }

    const sortedChapters = [...chapterData].sort((a, b) => a.start - b.start);

    sortedChapters.forEach((chapter, index) => {
        const startMessage = $(`.mes[mesid="${chapter.start}"]`);
        if (startMessage.length === 0) return;

        const chapterNumber = pad(index + 1, 2);
        const headerHtml = `
            <div class="chapterizer-header ${chapter.collapsed ? 'collapsed' : ''}" data-chapter-id="${chapter.id}" style="background-color: ${chapter.colors.titleBg}; color: ${chapter.colors.titleText};">
                <i class="chapterizer-toggle-icon fas fa-chevron-down"></i>
                <div class="chapterizer-actions">
                    <i class="chapterizer-edit-btn fas fa-pencil-alt" title="Edit Chapter"></i>
                    <i class="chapterizer-delete-btn fas fa-times-circle" title="Delete Chapter"></i>
                </div>
                <div class="chapterizer-content-wrapper">
                    <div class="chapterizer-top-divider"><span class="chapterizer-divider-text">CHAPTER ${chapterNumber}</span></div>
                    <div class="chapterizer-main-title">${chapter.name}</div>
                </div>
            </div>`;

        startMessage.before(headerHtml);

        const chapterEnd = resolveChapterEnd(chapter);

        if (chapter.collapsed) {
            for (let i = chapter.start; i <= chapterEnd; i++) {
                $(`.mes[mesid="${i}"]`).hide();
            }
        }
    });
}

function renderChapterIndex() {
    const $list = $('#chapterizer-index-panel .chapterizer-index-list');
    if (!$list.length) return;
    $list.empty();

    if (!getSettings().isEnabled || !chapterData || chapterData.length === 0) {
        return;
    }

    const sortedChapters = [...chapterData].sort((a, b) => a.start - b.start);
    sortedChapters.forEach((chapter, index) => {
        const chapterNumber = pad(index + 1, 2);
        const listItem = $(`
            <li data-chapter-id="${chapter.id}">
                <span class="chapter-num">#${chapterNumber}</span>
                <span class="chapter-name">${chapter.name}</span>
            </li>
        `);
        $list.append(listItem);
    });
}

// --- 이벤트 핸들러 및 상태 변경 로직 ---

function updateSelectModeUI() {
    const settings = getSettings();
    const isActive = settings.isSelectModeActive;
    $('#chapterizerSelectModeBtn').text(isActive ? 'Cancel Selection' : 'Select Messages');
    $('#chapterizerCreationControls').toggle(isActive);
    if (!isActive) clearSelections();
}

function clearSelections() {
    selectedMessages.forEach(id => $(`.mes[mesid="${id}"]`).removeClass('chapterizer-selected'));
    selectedMessages = [];
}

function toggleSelectMode() {
    const settings = getSettings();
    settings.isSelectModeActive = !settings.isSelectModeActive;
    saveSettings();
    updateSelectModeUI();
}

async function handleCreateChapterClick() {
    if (selectedMessages.length !== 1) {
        toastr.warning("Please select a single message to start the chapter.");
        return;
    }

    const chapterName = $('#chapterizerChapterName').val().trim();
    if (!chapterName) {
        toastr.warning("Please enter a name for the chapter.");
        return;
    }

    const startId = Number(selectedMessages[0]);
    if (!Number.isFinite(startId)) {
        toastr.error("Could not determine the selected message. Please try again.");
        return;
    }

    if (chapterData.some(chapter => Number(chapter.start) === startId)) {
        toastr.warning("A chapter already begins at that message. Please choose a different start.");
        return;
    }

    const newChapter = {
        id: Date.now(),
        name: chapterName,
        start: startId,
        end: startId,
        collapsed: false,
        colors: {
            titleBg: $('#chapterizerTitleBgColor').val(),
            titleText: $('#chapterizerTitleColor').val(),
        }
    };

    const settings = getSettings();
    settings.lastUsedTitleBgColor = newChapter.colors.titleBg;
    settings.lastUsedTitleColor = newChapter.colors.titleText;
    settings.isSelectModeActive = false;
    saveSettings();

    chapterData.push(newChapter);
    recalculateChapterBounds();
    await saveChapters();

    $('#chapterizerChapterName').val('');
    toastr.success(`Chapter "${newChapter.name}" created!`);
    updateSelectModeUI();
    updateFullUI();
}

async function handleDeleteChapterClick(event) {
    event.stopPropagation();
    if (!confirm("Are you sure you want to delete this chapter?")) return;
    const chapterId = $(this).closest('.chapterizer-header').attr('data-chapter-id');
    const chapterIndex = chapterData.findIndex(c => c.id === Number(chapterId));
    if (chapterIndex !== -1) {
        chapterData.splice(chapterIndex, 1);
        recalculateChapterBounds();
        await saveChapters();
        updateFullUI();
    }
}

async function handleToggleChapter(chapterId) {
    const chapter = chapterData.find(c => c.id === Number(chapterId));
    if (!chapter) return;
    chapter.collapsed = !chapter.collapsed;
    await saveChapters();
    $(`.chapterizer-header[data-chapter-id="${chapterId}"]`).toggleClass('collapsed', chapter.collapsed);
    const chapterEnd = resolveChapterEnd(chapter);
    for (let i = chapter.start; i <= chapterEnd; i++) {
        $(`.mes[mesid="${i}"]`).toggle(!chapter.collapsed);
    }
}

function openEditModal(event) {
    event.stopPropagation();
    const chapterId = $(event.currentTarget).closest('.chapterizer-header').attr('data-chapter-id');
    const chapter = chapterData.find(c => c.id === Number(chapterId));
    if (!chapter) return;

    $('#chapterizer-edit-name').val(chapter.name);
    $('#chapterizer-edit-bg-color').val(chapter.colors.titleBg);
    $('#chapterizer-edit-text-color').val(chapter.colors.titleText);
    
    $('#chapterizer-edit-save-btn').off('click').on('click', () => saveChapterEdit(chapter.id));

    $('#chapterizer-edit-modal-overlay').removeClass('hidden');
}

async function saveChapterEdit(chapterId) {
    const chapter = chapterData.find(c => c.id === chapterId);
    if (!chapter) {
        console.error("[Chapterizer] Could not find chapter to save. ID:", chapterId);
        return;
    }

    const newName = $('#chapterizer-edit-name').val().trim();
    if (!newName) {
        toastr.warning("Chapter name cannot be empty.");
        return;
    }

    chapter.name = newName;
    chapter.colors.titleBg = $('#chapterizer-edit-bg-color').val();
    chapter.colors.titleText = $('#chapterizer-edit-text-color').val();

    await saveChapters();
    updateFullUI();
    closeEditModal();
    toastr.success("Chapter updated!");
}

function closeEditModal() {
    $('#chapterizer-edit-modal-overlay').addClass('hidden');
}

function updateSettingsUi() {
    const settings = getSettings();
    $('#chapterizerMasterEnable').prop('checked', settings.isEnabled);
    $('#chapterizerStatusIndicator').text(settings.isEnabled ? "Enabled" : "Disabled");
    
    // [수정] 패널을 강제로 열고 닫는 로직을 제거합니다.
    // 대신 내부 컨트롤만 비활성화/활성화 합니다.
    $('.chapterizer-settings .inline-drawer-content :input').prop('disabled', !settings.isEnabled);
    
    if (!settings.isEnabled && settings.isSelectModeActive) {
        settings.isSelectModeActive = false;
        saveSettings();
    }
    updateSelectModeUI();
    updateFullUI(); // 이 함수는 renderChapters와 renderChapterIndex를 호출합니다.
}

// --- 초기화 ---

async function initialize() {
    // 1. 동적 UI 요소 생성
    const indexHtml = `
        <div id="chapterizer-index-toggle-btn" title="Chapter Index" style="display: none;">
            <i class="fas fa-list-ol"></i>
        </div>
        <div id="chapterizer-index-panel" class="hidden">
            <div class="chapterizer-index-header">Chapter Index</div>
            <ul class="chapterizer-index-list"></ul>
        </div>
    `;
    const modalHtml = `
        <div id="chapterizer-edit-modal-overlay" class="hidden">
            <div class="chapterizer-edit-modal-content">
                <h4>Edit Chapter</h4>
                <div class="flex-container">
                    <label for="chapterizer-edit-name">Chapter Name:</label>
                    <input id="chapterizer-edit-name" type="text" class="text_pole">
                </div>
                <div class="flex-container">
                    <label for="chapterizer-edit-bg-color">Background Color:</label>
                    <input id="chapterizer-edit-bg-color" type="color">
                </div>
                <div class="flex-container">
                    <label for="chapterizer-edit-text-color">Text Color:</label>
                    <input id="chapterizer-edit-text-color" type="color">
                </div>
                <div class="chapterizer-edit-modal-buttons">
                    <button id="chapterizer-edit-cancel-btn" class="menu_button">Cancel</button>
                    <button id="chapterizer-edit-save-btn" class="menu_button blue_button">Save</button>
                </div>
            </div>
        </div>
    `;
    // 2. UI를 body에 추가
    $('body').append(indexHtml).append(modalHtml);

    // 3. 설정 UI 로드 및 바인딩
    try {
        const settingsHtml = await $.get(`${extensionFolderPath}/settings_panel.html`);
        $("#extensions_settings").append(settingsHtml);
        const settings = getSettings();
        $('#chapterizerTitleBgColor').val(settings.lastUsedTitleBgColor);
        $('#chapterizerTitleColor').val(settings.lastUsedTitleColor);
        $('#chapterizerMasterEnable').on('change', () => { getSettings().isEnabled = $('#chapterizerMasterEnable').is(':checked'); saveSettings(); updateSettingsUi(); });
        $('#chapterizerSelectModeBtn').on('click', toggleSelectMode);
        $('#chapterizerCreateBtn').on('click', handleCreateChapterClick);
        $('#chapterizerExpandAll').on('click', async () => { chapterData.forEach(c => c.collapsed = false); await saveChapters(); updateFullUI(); });
        $('#chapterizerCollapseAll').on('click', async () => { chapterData.forEach(c => c.collapsed = true); await saveChapters(); updateFullUI(); });
    } catch (error) { console.error("[Chapterizer] Failed to load settings UI:", error); return; }

    // 4. 이벤트 핸들러 바인딩 (이벤트 위임 방식)
    $(document).on('click', '.mes', (event) => {
        if (!getSettings().isEnabled || !getSettings().isSelectModeActive) return;
        const $message = $(event.currentTarget);
        const mesId = Number($message.attr('mesid'));
        if (selectedMessages.includes(mesId)) {
            selectedMessages = selectedMessages.filter(id => id !== mesId);
            $message.removeClass('chapterizer-selected');
        } else {
            if (selectedMessages.length >= 1) {
                const oldestId = selectedMessages.shift();
                $(`.mes[mesid="${oldestId}"]`).removeClass('chapterizer-selected');
            }
            selectedMessages.push(mesId);
            $message.addClass('chapterizer-selected');
        }
        selectedMessages.sort((a, b) => a - b);
    });
    
    $(document).on('click', '.chapterizer-header', function() { handleToggleChapter($(this).attr('data-chapter-id')); });
    $(document).on('click', '.chapterizer-delete-btn', handleDeleteChapterClick);
    $(document).on('click', '.chapterizer-edit-btn', openEditModal);
    
    $('#chapterizer-index-toggle-btn').on('click', () => {
        $('#chapterizer-index-panel').toggleClass('hidden');
    });

    $('#chapterizer-index-panel').on('click', 'li', function() {
        const chapterId = $(this).attr('data-chapter-id');
        const header = $(`.chapterizer-header[data-chapter-id="${chapterId}"]`);
        if (header.length) {
            header[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
            $('#chapterizer-index-panel').addClass('hidden');
        }
    });

    $('#chapterizer-edit-cancel-btn').on('click', closeEditModal);
    $('#chapterizer-edit-modal-overlay').on('click', function(event) { if (event.target === this) closeEditModal(); });

    // 5. SillyTavern 핵심 이벤트 리스너 연결
    eventSource.on(event_types.CHAT_CHANGED, loadChapters);
    eventSource.on(event_types.MORE_MESSAGES_LOADED, debouncedUpdateUI);

    // [추가] 페이지 로드 시 패널을 기본적으로 닫힌 상태로 만듭니다.
    const $drawer = $('.chapterizer-settings .inline-drawer');
    if ($drawer.hasClass('open')) {
        $drawer.removeClass('open');
        $drawer.find('.inline-drawer-content').hide();
        $drawer.find('.inline-drawer-icon').removeClass('up').addClass('down');
    }
    
    // 6. 초기 UI 업데이트 및 데이터 로드
    updateSettingsUi();
    loadChapters();

    // 7. 최후의 보루: MutationObserver (채팅이 비동기적으로 로드될 경우를 대비)
    const chatElement = document.getElementById('chat');
    if (chatElement) {
        let observer = new MutationObserver((mutations) => {
            if (mutations.some(m => m.addedNodes.length > 0) && chapterData.length === 0) {
                const context = getContext();
                if (context?.chat?.length > 0) {
                    loadChapters();
                    observer.disconnect();
                }
            }
        });
        observer.observe(chatElement, { childList: true });
    }
}

eventSource.on(event_types.APP_READY, initialize);

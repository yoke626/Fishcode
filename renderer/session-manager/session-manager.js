(function () {
  'use strict'

  var copy = null
  var sessions = [] // full list from main
  var filtered = [] // after search filter
  var selected = new Set() // folder paths
  var busy = false

  var title = document.getElementById('title')
  var subtitle = document.getElementById('subtitle')
  var toolbar = document.getElementById('toolbar')
  var searchInput = document.getElementById('searchInput')
  var selectEmptyBtn = document.getElementById('selectEmptyBtn')
  var clearBtn = document.getElementById('clearBtn')
  var statusLine = document.getElementById('status')
  var listWrap = document.getElementById('listWrap')
  var groups = document.getElementById('groups')
  var searchEmpty = document.getElementById('searchEmpty')
  var resultPanel = document.getElementById('result')
  var footer = document.getElementById('footer')
  var summary = document.getElementById('summary')
  var deleteBtn = document.getElementById('deleteBtn')
  var footerHint = document.getElementById('footerHint')
  var confirmModal = document.getElementById('confirm')
  var confirmTitle = document.getElementById('confirmTitle')
  var confirmBody = document.getElementById('confirmBody')
  var confirmCancel = document.getElementById('confirmCancel')
  var confirmOk = document.getElementById('confirmOk')

  function el(tag, className, text) {
    var node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined) node.textContent = text
    return node
  }

  function applyCopy(c) {
    title.textContent = c.title
    subtitle.textContent = c.subtitle
    searchInput.placeholder = c.searchPlaceholder
    selectEmptyBtn.textContent = c.selectEmpty
    clearBtn.textContent = c.clearSelection
    deleteBtn.textContent = c.deleteButton
    footerHint.textContent = c.footerHint
    confirmTitle.textContent = c.deleteConfirmTitle
    confirmCancel.textContent = c.closeButton
    confirmOk.textContent = c.deleteButton
  }

  function timeAgo(ts, now) {
    var diff = Math.max(0, now - ts)
    if (diff < 60 * 1000) return copy.timeJustNow
    var min = Math.floor(diff / 60000)
    if (min < 60) return copy.timeMinutes.replace('{n}', String(min))
    var hr = Math.floor(min / 60)
    if (hr < 24) return copy.timeHours.replace('{n}', String(hr))
    return copy.timeDays.replace('{n}', String(Math.floor(hr / 24)))
  }

  function sizeText(bytes) {
    if (bytes < 1024) return copy.sizeB.replace('{n}', String(bytes))
    if (bytes < 1024 * 1024) return copy.sizeKB.replace('{n}', (bytes / 1024).toFixed(1))
    return copy.sizeMB.replace('{n}', (bytes / 1024 / 1024).toFixed(1))
  }

  /** Best-effort readable project path from a scope key (`--E-dpskharness-fishcode--`). */
  function scopeName(scope) {
    var inner = scope.replace(/^--/, '').replace(/--$/, '')
    return inner.replace(/-/g, '\\')
  }

  function isProtected(s) {
    return s.active || s.protected
  }

  function render() {
    groups.innerHTML = ''
    if (filtered.length === 0) {
      searchEmpty.hidden = false
      return
    }
    searchEmpty.hidden = true

    var byScope = {}
    filtered.forEach(function (s) {
      ;(byScope[s.scope] = byScope[s.scope] || []).push(s)
    })

    Object.keys(byScope).forEach(function (scope) {
      var list = byScope[scope]
      var group = el('div', 'group')
      var header = el('div', 'group-header')
      var name = el('span', 'group-name', scopeName(scope))
      var count = el('span', 'group-count', scopeLabel(scope) + ' ' + list.length)
      header.appendChild(name)
      header.appendChild(count)
      group.appendChild(header)

      list.forEach(function (s) {
        group.appendChild(buildRow(s))
      })
      groups.appendChild(group)
    })
  }

  function scopeLabel(scope) {
    return copy.scopeLabel
  }

  function buildRow(s) {
    var row = el('div', 'session-row')
    var check = document.createElement('input')
    check.type = 'checkbox'
    var protectedRow = isProtected(s)
    check.checked = selected.has(s.folder)
    check.disabled = protectedRow
    check.addEventListener('change', function () {
      if (check.checked) selected.add(s.folder)
      else selected.delete(s.folder)
      updateSelectionUi()
    })
    row.appendChild(check)

    var main = el('div', 'session-main')
    var t = el('div', 'session-title' + (s.title ? '' : ' empty'), s.title || copy.noTitle)
    main.appendChild(t)
    var meta = el('div', 'session-meta')
    if (s.protected) meta.appendChild(el('span', 'badge badge-current', copy.currentBadge))
    if (s.active) meta.appendChild(el('span', 'badge badge-active', copy.activeBadge))
    if (s.corrupt) meta.appendChild(el('span', 'badge badge-corrupt', copy.corruptBadge))
    main.appendChild(meta)
    row.appendChild(main)

    row.appendChild(el('span', 'session-time', timeAgo(s.updatedAt, Date.now())))
    row.appendChild(el('span', 'session-size', sizeText(s.fileBytes)))
    return row
  }

  function updateSelectionUi() {
    summary.textContent = copy.selectedCount.replace('{count}', String(selected.size))
    deleteBtn.disabled = selected.size === 0 || busy
    selectEmptyBtn.disabled = busy
    clearBtn.disabled = busy
  }

  function showStatus(text) {
    statusLine.textContent = text
    statusLine.hidden = false
  }

  function hideStatus() {
    statusLine.hidden = true
  }

  function showResult(kind, htmlOrText, failed) {
    resultPanel.className = kind
    resultPanel.hidden = false
    resultPanel.innerHTML = ''
    var line = el('div', null, htmlOrText)
    resultPanel.appendChild(line)
    if (failed && failed.length) {
      var ul = el('ul', 'failed-list')
      failed.forEach(function (f) {
        ul.appendChild(el('li', null, f.folder + '：' + f.reason))
      })
      resultPanel.appendChild(ul)
    }
  }

  function hideResult() {
    resultPanel.hidden = true
  }

  function applySearch() {
    var q = searchInput.value.trim().toLowerCase()
    filtered = q
      ? sessions.filter(function (s) {
          return s.title !== null && s.title.toLowerCase().indexOf(q) !== -1
        })
      : sessions.slice()
    render()
  }

  function selectEmpty() {
    sessions.forEach(function (s) {
      if (!isProtected(s) && s.title === null) selected.add(s.folder)
    })
    render()
    updateSelectionUi()
  }

  function clearSelection() {
    selected.clear()
    render()
    updateSelectionUi()
  }

  function openConfirm() {
    if (selected.size === 0) {
      showResult('failure', copy.emptySelection)
      return
    }
    var folders = Array.from(selected)
    var totalBytes = folders.reduce(function (sum, folder) {
      var s = sessions.find(function (x) {
        return x.folder === folder
      })
      return sum + (s ? s.fileBytes : 0)
    }, 0)
    confirmBody.textContent = copy.deleteConfirmBody
      .replace('{count}', String(folders.length))
      .replace('{size}', sizeText(totalBytes))
    confirmModal.hidden = false
    confirmOk.disabled = false
    confirmOk.textContent = copy.deleteButton
  }

  function closeConfirm() {
    confirmModal.hidden = true
  }

  async function runDelete() {
    var folders = Array.from(selected)
    if (folders.length === 0) return
    busy = true
    confirmOk.disabled = true
    confirmOk.textContent = copy.deleteBusy
    deleteBtn.textContent = copy.deleteBusy
    deleteBtn.disabled = true
    hideResult()

    try {
      var result = await window.sessionManagerAPI.delete(folders)
      if (!result || typeof result !== 'object') throw new Error('bad response')
      var deleted = Array.isArray(result.deleted) ? result.deleted : []
      var failed = Array.isArray(result.failed) ? result.failed : []

      // Drop the deleted folders locally, then refresh the real list.
      deleted.forEach(function (f) {
        selected.delete(f)
      })
      try {
        var list = await window.sessionManagerAPI.list()
        if (list && Array.isArray(list.sessions)) {
          sessions = list.sessions
          applySearch()
        }
      } catch (e) {
        /* the sidebar refresh already happened; list reload is best-effort */
      }

      if (failed.length === 0) {
        showResult('success', copy.deleteSuccess.replace('{count}', String(deleted.length)) + '。' + copy.refreshNote)
      } else if (deleted.length === 0) {
        showResult('failure', copy.deleteFailed.replace('{detail}', failed[0].reason))
      } else {
        showResult('failure', copy.deletePartial.replace('{count}', String(deleted.length)).replace('{failed}', String(failed.length)), failed)
      }
    } catch (error) {
      showResult('failure', copy.deleteFailed.replace('{detail}', String(error && error.message ? error.message : error)))
    }

    busy = false
    closeConfirm()
    deleteBtn.textContent = copy.deleteButton
    updateSelectionUi()
  }

  async function init() {
    copy = await window.sessionManagerAPI.getCopy()
    applyCopy(copy)

    showStatus(copy.statusLoading)

    try {
      var list = await window.sessionManagerAPI.list()
      if (!list || typeof list !== 'object') throw new Error('bad response')

      if (list.ready === false) {
        showStatus(copy.statusUnavailable)
        return
      }
      if (list.error) {
        showStatus(copy.statusLoadFailed.replace('{detail}', list.error))
        return
      }

      sessions = Array.isArray(list.sessions) ? list.sessions : []
      var currentId = typeof list.currentSessionId === 'string' ? list.currentSessionId : null
      if (currentId) {
        sessions = sessions.map(function (s) {
          if (s.sessionId === currentId) return Object.assign({}, s, { protected: true })
          return s
        })
      }

      hideStatus()
      toolbar.hidden = false
      footer.hidden = false
      listWrap.hidden = false

      if (sessions.length === 0) {
        showStatus(copy.statusEmpty)
        toolbar.hidden = true
        footer.hidden = true
        listWrap.hidden = true
        return
      }

      applySearch()
      updateSelectionUi()
    } catch (error) {
      showStatus(copy.statusLoadFailed.replace('{detail}', String(error && error.message ? error.message : error)))
    }
  }

  searchInput.addEventListener('input', applySearch)
  selectEmptyBtn.addEventListener('click', selectEmpty)
  clearBtn.addEventListener('click', clearSelection)
  deleteBtn.addEventListener('click', openConfirm)
  confirmCancel.addEventListener('click', closeConfirm)
  confirmOk.addEventListener('click', function () {
    void runDelete()
  })

  void init()
})()

(function () {
  'use strict'

  var copy = null
  var pollTimer = null
  var applyPending = false

  var title = document.getElementById('title')
  var subtitle = document.getElementById('subtitle')
  var statusLine = document.getElementById('status')
  var providerSelect = document.getElementById('providerSelect')
  var presetNote = document.getElementById('presetNote')
  var getKeyBtn = document.getElementById('getKeyBtn')
  var keyInput = document.getElementById('keyInput')
  var showKey = document.getElementById('showKey')
  var customFields = document.getElementById('customFields')
  var baseUrlInput = document.getElementById('baseUrlInput')
  var modelInput = document.getElementById('modelInput')
  var protocolSelect = document.getElementById('protocolSelect')
  var applyBtn = document.getElementById('applyBtn')
  var resultPanel = document.getElementById('result')
  var resultTitle = document.getElementById('resultTitle')
  var resultMessage = document.getElementById('resultMessage')
  var usageSteps = document.getElementById('usageSteps')

  function el(tag, className, text) {
    var node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined) node.textContent = text
    return node
  }

  function option(text, value) {
    var node = document.createElement('option')
    node.textContent = text
    node.value = value
    return node
  }

  function applyCopy(c) {
    title.textContent = c.title
    subtitle.textContent = c.subtitle
    document.getElementById('providerLabel').textContent = c.providerLabel
    document.getElementById('keyLabel').textContent = c.keyLabel
    keyInput.placeholder = c.keyPlaceholder
    document.getElementById('keyHelp').textContent = c.keyHelp
    document.getElementById('showKeyLabel').textContent = c.showKey
    document.getElementById('customBaseUrlLabel').textContent = c.customBaseUrl
    document.getElementById('customModelLabel').textContent = c.customModel
    document.getElementById('customProtocolLabel').textContent = c.customProtocol
    document.getElementById('customNote').textContent = c.customNote
    presetNote.textContent = c.presetNote
    getKeyBtn.textContent = c.getKeyButton
    applyBtn.textContent = c.applyButton
    document.getElementById('privacyLine').textContent = c.privacyLine

    providerSelect.appendChild(option(c.providerZhipu, 'zhipu'))
    providerSelect.appendChild(option(c.providerCustom, 'custom'))
    protocolSelect.appendChild(option(c.customProtocolOpenai, 'openai'))
    protocolSelect.appendChild(option(c.customProtocolAnthropic, 'anthropic'))

    baseUrlInput.value = c.customDefaults.baseUrl
    modelInput.value = c.customDefaults.model
    protocolSelect.value = c.customDefaults.protocol
  }

  function renderStatus(state) {
    if (state.backendState !== 'ready') {
      statusLine.textContent = state.backendState === 'failed' ? copy.backendFailed : copy.backendStarting
      setFormEnabled(false)
      return
    }
    if (!state.available) {
      statusLine.textContent = copy.pluginUnavailable
      setFormEnabled(false)
      return
    }
    if (state.currentProvider === 'zhipu') {
      statusLine.textContent = copy.statusConfigured.replace('{provider}', copy.providerZhipu)
    } else if (state.currentProvider === 'custom') {
      statusLine.textContent = copy.statusCustom
    } else {
      statusLine.textContent = copy.statusNone
    }
    setFormEnabled(true)

    // Prefill the custom fields from the stored provider, but never clobber
    // what the user already typed (detected via "still equals defaults").
    if (state.storedProvider && providerSelect.value === 'custom') {
      if (baseUrlInput.value === copy.customDefaults.baseUrl) baseUrlInput.value = state.storedProvider.baseUrl
      if (modelInput.value === copy.customDefaults.model) modelInput.value = state.storedProvider.model
      if (protocolSelect.value === copy.customDefaults.protocol) protocolSelect.value = state.storedProvider.protocol
    }
  }

  function setFormEnabled(enabled) {
    providerSelect.disabled = !enabled
    keyInput.disabled = !enabled
    showKey.disabled = !enabled
    baseUrlInput.disabled = !enabled
    modelInput.disabled = !enabled
    protocolSelect.disabled = !enabled
    applyBtn.disabled = !enabled || applyPending
    if (enabled && !applyPending) applyBtn.textContent = copy.applyButton
  }

  function updateCustomVisibility() {
    var custom = providerSelect.value === 'custom'
    customFields.hidden = !custom
    presetNote.hidden = custom
    getKeyBtn.hidden = custom
  }

  function showSuccess(result) {
    resultPanel.className = 'success'
    resultPanel.hidden = false
    resultTitle.textContent = result.title || copy.usage.title
    resultMessage.textContent = result.message || ''
    resultMessage.hidden = !result.message
    usageSteps.innerHTML = ''
    copy.usage.steps.forEach(function (step) {
      usageSteps.appendChild(el('li', null, step))
    })
  }

  function showFailure(failureTitle, failureMessage) {
    resultPanel.className = 'failure'
    resultPanel.hidden = false
    resultTitle.textContent = failureTitle || ''
    resultMessage.textContent = failureMessage || ''
    resultMessage.hidden = !failureMessage
    usageSteps.innerHTML = ''
  }

  function hideResult() {
    resultPanel.hidden = true
  }

  function refresh() {
    window.visionSetupAPI.getState().then(function (state) {
      if (!state || typeof state !== 'object') return
      renderStatus(state)
      if (state.backendState === 'ready' || state.backendState === 'failed') stopPolling()
    })
  }

  function startPolling() {
    if (!pollTimer) pollTimer = setInterval(refresh, 1500)
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  function onApply() {
    if (applyPending) return
    var rawKey = keyInput.value.trim()
    if (rawKey.length < 1 || rawKey.length > 512 || !/^[\x20-\x7E]+$/.test(rawKey)) {
      showFailure(copy.results['invalid-request'].title, copy.invalidKey)
      return
    }
    var request
    if (providerSelect.value === 'custom') {
      var baseUrl = baseUrlInput.value.trim()
      var model = modelInput.value.trim()
      if (!baseUrl || !model) {
        showFailure(copy.results['invalid-request'].title, copy.invalidForm)
        return
      }
      request = {
        rawKey: rawKey,
        presetId: 'custom',
        custom: { baseUrl: baseUrl, model: model, protocol: protocolSelect.value },
      }
    } else {
      request = { rawKey: rawKey, presetId: 'zhipu' }
    }

    applyPending = true
    applyBtn.textContent = copy.applyButtonBusy
    applyBtn.disabled = true
    hideResult()

    window.visionSetupAPI
      .apply(request)
      .then(function (result) {
        applyPending = false
        applyBtn.disabled = false
        applyBtn.textContent = copy.applyButton
        if (!result || typeof result !== 'object') return
        if (result.ok) {
          showSuccess(result)
          refresh() // re-read state to refresh the status line
        } else {
          showFailure(result.title, result.message)
        }
      })
      .catch(function () {
        applyPending = false
        applyBtn.disabled = false
        applyBtn.textContent = copy.applyButton
        showFailure(copy.results.network.title, copy.results.network.message)
      })
  }

  window.visionSetupAPI.getCopy().then(function (c) {
    copy = c
    applyCopy(c)
    providerSelect.addEventListener('change', updateCustomVisibility)
    showKey.addEventListener('change', function () {
      keyInput.type = showKey.checked ? 'text' : 'password'
    })
    getKeyBtn.addEventListener('click', function () {
      window.visionSetupAPI.openConsole()
    })
    applyBtn.addEventListener('click', onApply)
    updateCustomVisibility()
    startPolling()
    refresh()
  })
})()

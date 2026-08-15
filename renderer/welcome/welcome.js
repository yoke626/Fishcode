(function () {
  'use strict'

  var copy = null
  var step = 0
  var settings = { autoLaunch: false, minimizeToTray: true, petEnabled: true }

  var title = document.getElementById('title')
  var subtitle = document.getElementById('subtitle')
  var indicator = document.getElementById('indicator')
  var content = document.getElementById('content')
  var controls = document.getElementById('controls')

  function el(tag, className, text) {
    var node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined) node.textContent = text
    return node
  }

  function render() {
    content.innerHTML = ''
    controls.innerHTML = ''
    renderIndicator()
    if (step === 0) renderIntro()
    else if (step === 1) renderOptions()
    else renderFinish()
  }

  function renderIndicator() {
    indicator.innerHTML = ''
    for (var i = 0; i < copy.steps.length; i++) {
      var li = el('li')
      if (i === step) li.className = 'active'
      indicator.appendChild(li)
    }
  }

  function renderIntro() {
    content.appendChild(el('p', 'step-body', copy.steps[0].body))
    var api = el('button', 'btn btn-primary', copy.apiKeyButton)
    api.addEventListener('click', function () {
      window.welcomeAPI.openApiKey()
    })
    content.appendChild(api)
    controls.appendChild(navButtons())
  }

  function renderOptions() {
    content.appendChild(el('p', 'step-body', copy.steps[1].body))
    var toggles = [
      ['autoLaunch', copy.toggles.autoLaunch],
      ['minimizeToTray', copy.toggles.minimizeToTray],
      ['petEnabled', copy.toggles.petEnabled],
    ]
    toggles.forEach(function (pair) {
      var key = pair[0]
      var label = el('label', 'toggle')
      var input = document.createElement('input')
      input.type = 'checkbox'
      input.checked = settings[key]
      input.addEventListener('change', function () {
        settings[key] = input.checked
      })
      label.appendChild(input)
      label.appendChild(el('span', null, pair[1]))
      content.appendChild(label)
    })
    controls.appendChild(navButtons())
  }

  function renderFinish() {
    content.appendChild(el('p', 'step-body', copy.steps[2].body))
    if (copy.visionLink) {
      content.appendChild(el('p', 'step-body', copy.visionHint))
      var vision = el('button', 'btn btn-ghost', copy.visionLink)
      vision.addEventListener('click', function () {
        window.welcomeAPI.openVisionSetup()
      })
      content.appendChild(vision)
    }
    var finish = el('button', 'btn btn-primary', copy.finishButton)
    finish.addEventListener('click', complete)
    controls.appendChild(finish)
  }

  function navButtons() {
    var row = el('div', 'controls-row')
    var back = el('button', 'btn', copy.backButton)
    back.disabled = step === 0
    back.addEventListener('click', function () {
      step -= 1
      render()
    })
    var next = el('button', 'btn btn-primary', copy.nextButton)
    next.addEventListener('click', function () {
      step += 1
      render()
    })
    var skip = el('button', 'btn btn-ghost', copy.skipButton)
    skip.addEventListener('click', complete)
    row.appendChild(back)
    row.appendChild(next)
    row.appendChild(skip)
    return row
  }

  function complete() {
    window.welcomeAPI.complete({
      onboardingDone: true,
      autoLaunch: settings.autoLaunch,
      minimizeToTray: settings.minimizeToTray,
      petEnabled: settings.petEnabled,
    })
  }

  window.welcomeAPI
    .getCopy()
    .then(function (c) {
      copy = c
      title.textContent = c.title
      subtitle.textContent = c.subtitle
      return window.welcomeAPI.getSettings()
    })
    .then(function (s) {
      if (s && typeof s === 'object') {
        settings.autoLaunch = !!s.autoLaunch
        settings.minimizeToTray = !!s.minimizeToTray
        settings.petEnabled = !!s.petEnabled
      }
      render()
    })
})()

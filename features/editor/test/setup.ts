// jsdom has no layout, so Range lacks getClientRects: https://github.com/jsdom/jsdom/issues/3002
Range.prototype.getClientRects = () => document.body.getClientRects()
Range.prototype.getBoundingClientRect = () => document.body.getBoundingClientRect()

// React only runs act() without warnings when this global is set: https://react.dev/reference/react/act
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true)

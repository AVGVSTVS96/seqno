// jsdom has no layout, so Range lacks getClientRects: https://github.com/jsdom/jsdom/issues/3002
Range.prototype.getClientRects = () => document.body.getClientRects()
Range.prototype.getBoundingClientRect = () => document.body.getBoundingClientRect()

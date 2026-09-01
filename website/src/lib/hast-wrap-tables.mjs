/*
 * Wraps every rendered table in a scroll container. The roadmap's tables are
 * wider than a phone, and without this the page itself scrolls sideways.
 */
export const hastWrapTables = {
  name: 'wrap-tables',
  element: {
    filter: ['table'],
    visit(node, ctx) {
      ctx.wrapNode(node, {
        type: 'element',
        tagName: 'div',
        properties: { className: ['table-scroll'] },
        children: [],
      });
    },
  },
};

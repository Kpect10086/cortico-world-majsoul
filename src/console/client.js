export default {
  panels: {
    game: {
      mount(ctx) {
        const {root, ui, signal} = ctx;
        const actions = ui.actions(), status = ui.h('div'), message = ui.msgline();
        const details = ui.foldSheet('public-state', {title: '公开牌局详情'});
        const json = ui.h('pre', 'mono'); details.body.append(json);
        let loading = false, last;
        const refresh = ui.button('刷新状态', {onClick: () => void update()});
        const connect = ui.button('打开游戏', {onClick: () => void update('connect')});
        const attach = ui.button('附着桥接', {onClick: () => void update('attach')});
        function buttons() {
          refresh.disabled = loading;
          connect.disabled = loading || !!last?.connected || !!last?.busy;
          attach.disabled = loading || !!last?.busy;
        }
        async function update(method = 'state') {
          if (loading || signal.aborted) return;
          loading = true; buttons();
          try {
            const state = await ctx.invoke(method);
            if (signal.aborted) return;
            last = state;
            const view = state.observation;
            status.replaceChildren(ui.kv([
              {k: '牌局桥接', v: state.connected ? '已连接' : '未连接'},
              {k: '游戏操作', v: state.allowActions ? '允许' : '暂停'},
              {k: '牌局状态', v: view.reason || (view.active ? '进行中' : '等待进入牌局')},
              {k: '当前操作', v: state.busy ? '等待动作回执' : view.ready ? '等待出牌决策' : '等待游戏消息'},
              {k: '本人座位', v: view.seat === null ? '尚未确认' : view.seat + 1},
              {k: '本人手牌', v: state.handAnalysis?.handText || view.hand.join(' ') || '暂无'},
              {k: '摸牌', v: view.drawn || '暂无'},
              {k: '决策目标', v: `${state.decisionTargetMs / 1000} 秒`},
            ]));
            json.textContent = JSON.stringify(state, null, 2);
            message.textContent = state.error || ''; message.classList.toggle('bad', !!state.error);
          } catch (error) {
            if (!signal.aborted) {message.textContent = String(error); message.classList.add('bad');}
          } finally {loading = false; if (!signal.aborted) buttons();}
        }
        actions.append(refresh, connect, attach);
        root.append(ui.section('游戏状态', '打开专用游戏页面后，手动登录和开局；附着桥接会保留当前页面。'),
          actions, message, status, details.el);
        void update();
        ctx.interval(() => void update(), 2000);
      },
    },
  },
};

# 参考来源与许可

明石全局时钟的规则改写自 [航海日誌 扩张版](https://github.com/nekopanda/logbook)，参考提交 `76fdfdc16bf4579caf471072adbef17856d53a60`：

- `main/logbook/data/context/GlobalContext.java` 的 `doPort` / `doChange`。
- `main/logbook/internal/AkashiTimer.java` 的 20 分钟门槛与按入渠时间推算每 HP 修理间隔的方法。
- `main/logbook/dto/DockDto.java` 的修理范围判定。

原项目使用 MIT 许可，原始完整许可随包保存于 `third-party/logbook-LICENSE.txt`（原始编码保留）。本项目未包含 Java 源码，也不包含舰娘图像或游戏资源。

本轮后续修理节点使用 `(api_ndock_time - 30 秒) / 缺失 HP` 推算间隔，节点向上取整到秒，20 分钟保底至少 1 HP。参考 [Wiki 明石泊地修理说明](https://wikiwiki.jp/kancolle/%E6%98%8E%E7%9F%B3)（2026-09-13 核对），不套用旧航海日誌额外的 60 秒保守偏移。节点为本地估计，实际修理量以回港数据为准；尚未计算朝日改带来的修理加成。

poi 插件接口核对 [poi v12.0.0](https://github.com/poooi/poi/tree/v12.0.0) 的 `read-plugin`、`lifecycle`、`plugin-window-wrapper` 与 `data-resolver`。本插件使用宿主提供的 React，不随插件安装另一份 React。

野埼机制补充参考 [舰これ Wiki 野埼](https://wikiwiki.jp/kancolle/%E9%87%8E%E5%9F%BC)（2026-09-13 读取）及 [poooi/plugin-anchorage-repair](https://github.com/poooi/plugin-anchorage-repair/tree/dd6de413d44895b7ea923ceeb6545bcc17deca73) 中的舰船 ID 与条件说明。野埼不是上述旧版航海日誌已经实现的功能。

到期回港无论是否实际给粮均重置野埼周期的规则，参考 [ぜかましねっと的母港给粮机制说明](https://zekamashi.net/kancolle-kouryaku/home-port-supply-ship-system/) 和 [野埼プリセット](https://note.com/shiroos/n/nba4295f43dca)（2026-09-13 核对）。

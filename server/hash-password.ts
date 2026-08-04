import { MIN_ADMIN_PASSWORD_LENGTH } from "../shared/auth.js";
import { hashPassword } from "./security.js";

const password = process.argv[2] ?? process.env.RADAR_ADMIN_PASSWORD;
if (!password) {
  console.error(
    `请通过 RADAR_ADMIN_PASSWORD 环境变量或第一个命令参数提供至少 ${MIN_ADMIN_PASSWORD_LENGTH} 位的管理员密码`,
  );
  process.exitCode = 1;
} else {
  console.log(await hashPassword(password));
}

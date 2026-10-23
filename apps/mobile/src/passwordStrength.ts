import { passwordProblem } from "@leks/protocol";

export interface Strength {
  /** 0 not allowed, 1 acceptable, 2 good, 3 strong. */
  score: 0 | 1 | 2 | 3;
  hint: string;
}

/** The meter under the password field; acceptance uses the same rule as the server. */
export function passwordStrength(password: string, username?: string): Strength {
  const problem = passwordProblem(password, username);
  switch (problem) {
    case "too_short":
      return { score: 0, hint: "Не меньше 8 символов" };
    case "too_long":
      return { score: 0, hint: "Не больше 128 символов" };
    case "common":
      return { score: 0, hint: "Этот пароль слишком популярный, его легко подобрать" };
    case "same_as_username":
      return { score: 0, hint: "Пароль не должен совпадать с именем пользователя" };
    case "too_simple":
      return { score: 0, hint: "Слишком простой: одинаковые или идущие подряд символы" };
  }
  const classes = [/[a-zа-яё]/, /[A-ZА-ЯЁ]/, /[0-9]/, /[^a-zA-Zа-яА-ЯёЁ0-9]/].filter((re) => re.test(password)).length;
  if (password.length >= 12 && classes >= 3) return { score: 3, hint: "Надёжный пароль" };
  if (password.length >= 10 && classes >= 2) return { score: 2, hint: "Хороший пароль" };
  return { score: 1, hint: "Подходит, но лучше длиннее или с цифрами и знаками" };
}

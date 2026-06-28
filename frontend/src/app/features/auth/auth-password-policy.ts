export const AUTH_PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;

export const AUTH_PASSWORD_REQUIREMENT_MESSAGE =
  'Minimo 8 caracteres, con al menos una minuscula, una mayuscula, un numero y un caracter especial.';

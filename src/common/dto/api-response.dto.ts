export class ApiResponseDto<T> {
  code = 1000;
  message?: string;
  result?: T;

  constructor(init?: Partial<ApiResponseDto<T>>) {
    Object.assign(this, init);
  }
}

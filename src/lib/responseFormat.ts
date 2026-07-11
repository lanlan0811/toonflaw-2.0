export interface ApiResponse {
  code: number;
  data: any;
  message: string;
}

// 成功回调
export function success<T>(data: T | null = null, message: string = "成功"): ApiResponse {
  return {
    code: 200,
    data,
    message,
  };
}

// 客户端错误响应
export function error<T>(message: string = "", data: T | null = null, code: number = 400): ApiResponse {
  return {
    code,
    data,
    message,
  };
}

/**
 * 自动颜色提取 Hook
 * 当用户上传封面图时自动提取主色调并匹配到 Tailwind 100 级别颜色
 */

import { useState, useCallback } from 'react';
import { processImageColors } from '../utils/colorExtractor';

export function useAutoColorExtraction() {
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState(null);

  /**
   * 从图片文件自动提取颜色
   * @param {File} file - 封面图文件对象
   * @returns {Promise<object>} 颜色属性对象
   */
  const extractColorsFromFile = useCallback(async (file) => {
    setIsProcessing(true);
    setError(null);

    try {
      // 验证文件类型
      if (!file.type.startsWith('image/')) {
        throw new Error('Invalid file type. Please upload an image file.');
      }

      // 创建临时 URL 用于读取图片
      const imageUrl = URL.createObjectURL(file);

      // 提取颜色
      const colors = await processImageColors(imageUrl);

      // 清理临时 URL
      URL.revokeObjectURL(imageUrl);

      setIsProcessing(false);
      return colors;
    } catch (err) {
      setError(err.message);
      setIsProcessing(false);
      throw err;
    }
  }, []);

  /**
   * 从图片 URL 自动提取颜色
   * @param {string} imageUrl - 封面图 URL
   * @returns {Promise<object>} 颜色属性对象
   */
  const extractColorsFromUrl = useCallback(async (imageUrl) => {
    setIsProcessing(true);
    setError(null);

    try {
      const colors = await processImageColors(imageUrl);
      setIsProcessing(false);
      return colors;
    } catch (err) {
      setError(err.message);
      setIsProcessing(false);
      throw err;
    }
  }, []);

  /**
   * 批量处理多个封面图
   * @param {File[]|string[]} images - 文件数组或 URL 数组
   * @returns {Promise<object[]>} 颜色属性数组
   */
  const extractColorsBatch = useCallback(async (images) => {
    setIsProcessing(true);
    setError(null);

    try {
      const results = await Promise.all(
        images.map((img) =>
          typeof img === 'string'
            ? extractColorsFromUrl(img)
            : extractColorsFromFile(img)
        )
      );

      setIsProcessing(false);
      return results;
    } catch (err) {
      setError(err.message);
      setIsProcessing(false);
      throw err;
    }
  }, [extractColorsFromFile, extractColorsFromUrl]);

  return {
    extractColorsFromFile,
    extractColorsFromUrl,
    extractColorsBatch,
    isProcessing,
    error,
  };
}

export default useAutoColorExtraction;
